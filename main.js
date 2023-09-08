import { checkAddress, createKeyMulti, encodeAddress, blake2AsHex, decodeAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/util-crypto@12.3.1/+esm';
import { web3Accounts, web3Enable, web3FromAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/extension-dapp@0.46.5/+esm';
import { loadApi, initConnection, toDecimalUnit, getPrefix, getUnit, getIsConnected, getCurrentRelayChainBlockNumber, getProviderUrl } from './api.js';

// Simple place to dump log data that is then able to be sent to a clipboard
let loggedData = {};
// Key of what was most recently logged
let lastKeyInLoggedData = null;

// Sort addresses by hex.
const multisigSort = (a, b) => {
    const decodedA = decodeAddress(a);
    const decodedB = decodeAddress(b);
    for (let i = 0; i < decodedA.length; i++) {
        if (decodedA[i] < decodedB[i]) return -1;
        if (decodedA[i] > decodedB[i]) return 1;
    }
    return 0;
}

// Update the sender balance display
async function updateSenderBalance() {
    const balanceDisplay = document.getElementById("balance");
    balanceDisplay.innerHTML = "...";
    const sender = document.getElementById("sender").value;
    const api = await loadApi();
    if (!api || !sender) {
        return;
    }
    const resp = await api.query.system.account(sender);
    const balance = resp.data.free.toString();

    balanceDisplay.innerHTML = toDecimalUnit(balance);
}

// Update the multisig balance display
async function updateMultisigBalance() {
    const balanceDisplay = document.getElementById("multisigBalance");
    balanceDisplay.innerHTML = "...";
    const sender = document.getElementById("multisigAddress").value;
    const api = await loadApi();
    if (!api || !sender) {
        return;
    }
    const resp = await api.query.system.account(sender);
    const balance = resp.data.free.toString();

    balanceDisplay.innerHTML = toDecimalUnit(balance);
}

// Estimate the block number by date
async function updateBlockNumber(date) {
    const estimateDisplay = document.getElementById("actualBlock");
    estimateDisplay.value = null;
    const link = document.getElementById("subscanLink");
    link.style.display = "none";
    inProgress(true);

    if (!(date instanceof Date)) {
        date = new Date(Date.parse(document.getElementById("unlockDate").value));
    }

    // Reject old dates and bad dates
    if (!date || date < Date.now() || !getIsConnected()) {
        inProgress(false);
        return;
    }

    const currentBlockDate = new Date();
    const currentBlockNumber = await getCurrentRelayChainBlockNumber();

    // Get the timestamp for noon UTC on the given date
    const noonUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12));

    // Calculate the estimated block number for noon UTC on the given date
    const relayChainBlockTime = 6; // 6s per relay block
    const actualBlockNumber = currentBlockNumber + Math.round((+noonUTC - +currentBlockDate) / 1000 / relayChainBlockTime);
    estimateDisplay.value = actualBlockNumber;

    const url = {
        // Polkadot
        "90": "https://polkadot.subscan.io/block/",
        // Rococo
        "42": "https://rococo.subscan.io/block/",
    }

    link.href = `${url[getPrefix()]}${actualBlockNumber}`;
    link.style.display = "block";
    inProgress(false);

    return actualBlockNumber;
}

// Input is in Planck, but we want to show the getUnit() amount as well
function updateUnitValues() {
    const amountInput = document.getElementById("amount");
    const amount = Number(amountInput.value);
    const unitDisplay = document.getElementById("unit");

    // Update getUnit() display
    unitDisplay.textContent = `${toDecimalUnit(amount)} ${getUnit()}`;
}

// Pasting into the Transaction label will get us a
function populateFromPaste(data) {
    // [label,recipient,amount,date]
    const [label, recipient, amount, date, ...multisigs] = data.map(x => x.trim());

    // Populate the form fields
    const txLabel = document.getElementById('txLabel');
    txLabel.value = label;

    const recipientInput = document.getElementById('recipient');
    recipientInput.value = recipient;

    const amountInput = document.getElementById('amount');
    amountInput.value = amount;

    const unlockDate = document.getElementById('unlockDate');
    unlockDate.value = date;

    if (multisigs.length > 0) {
        document.getElementById("multisigCheckbox").checked = true;
        document.getElementById("multisigSignatories").value = multisigs.join("\n");
    }
    triggerUpdates();
}

function multisigProcess(doAlert = false) {
    document.getElementById("multisigAddress").value = "...";
    document.getElementById("multisigBalance").innerHTML = "...";
    const isMultisig = document.getElementById("multisigCheckbox").checked;
    const multisigThreshold = parseInt(document.getElementById("multisigThreshold").value);
    const multisigSignatories = document.getElementById("multisigSignatories").value.split("\n").map(x => x.trim()).filter(x => !!x);
    multisigSignatories.push(document.getElementById("sender").value);

    if (isMultisig) {
        if (multisigThreshold > multisigSignatories.length) {
            if (doAlert) alert(`Multisig setup is invalid. Wrong threshold or bad signatories.`);
            return;
        }
        try {
            multisigSignatories.forEach(signatory => {
                const check = checkAddress(signatory, getPrefix());
                if (!check[0]) {
                    if (doAlert) alert(`Signatory address "${signatory}" is invalid: ${check[1] || "unknown"}`);
                }
            });

            const multisigAddress = encodeAddress(createKeyMulti(multisigSignatories, multisigThreshold), getPrefix());
            document.getElementById("multisigAddress").value = multisigAddress;
            updateMultisigBalance();
            return [multisigAddress, multisigThreshold, multisigSignatories];
        } catch (e) {
            if (doAlert) alert(`Multisig setup is invalid. Wrong threshold or bad signatories: ${e.toString()}`);
            return;
        }
    }
}

// Do the actual transfer
async function createTransfer(event) {
    event.preventDefault();
    let sender = document.getElementById("sender").value;
    const txLabel = document.getElementById("txLabel").value;
    let recipient = document.getElementById("recipient").value;
    const amount = parseInt(document.getElementById("amount").value);
    const actualBlock = document.getElementById("actualBlock").value;
    const addressCheck = checkAddress(recipient, getPrefix());
    if (!addressCheck[0]) {
        alert(`Recipient address invalid: ${addressCheck[1] || "unknown"}`);
        return;
    }

    inProgress(true);

    const isMultisig = document.getElementById("multisigCheckbox").checked;

    recipient = encodeAddress(recipient, getPrefix());
    sender = encodeAddress(sender, getPrefix());

    const api = await loadApi();

    // Create the schedule
    const schedule = {
        start: actualBlock,
        period: 1, // Must be > 0, but we want to have just a one time thing.
        periodCount: 1, // Must be > 0, but we want to have just a one time thing.
        perPeriod: api.registry.createType("Balance", amount),
    };

    try {
        const transferCall = api.tx.timeRelease.transfer(recipient, schedule);
        const injector = await web3FromAddress(sender);

        const callData = transferCall.method.toHex();
        const callHash = blake2AsHex(callData);
        const logIt = [
            `<b>Parameters</b>: <code>Start: ${actualBlock}, Period: 1, Period Count: 1, Per Period: ${amount}</code>`,
            `<b>Call Hash</b>: <code>${callHash}</code>`,
            `<b>Call Data</b>: <code>${callData}</code>`,
        ];

        if (isMultisig) {
            const maxWeight = { refTime: 1_000_000_000, proofSize: 50_000 };

            const [multisigAddress, multisigThreshold, multisigSignatories] = multisigProcess(true);

            // We need to remove the sender and sort correctly before asMulti can be used.
            const sortedOthers = multisigSignatories.filter(x => x != sender).sort(multisigSort);

            const tx = api.tx.multisig.asMulti(multisigThreshold, sortedOthers, null, transferCall, maxWeight);
            const sending = tx.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel, callHash));
            loggedData[callHash] = {
                recipient,
                amount: amount.toLocaleString(),
                sender: multisigAddress,
                relayBlockUnlock: actualBlock,
                callHash,
                callData,
                status: "Sending",
                finalizedBlock: "unknown",
            };
            lastKeyInLoggedData = callHash;
            addLog([
                `Sending time release`,
                `<b>Recipient</b>: <code>${recipient}</code>`,
                `<b>Amount</b>: <code>${amount.toLocaleString()}</code>`,
                `<b>From Multisig</b>: <code>${multisigAddress}</code>`,
                `<b>Sender</b>: <code>${sender}</code>`,
                ...logIt],
                txLabel);
            await sending;
        } else {
            const sending = transferCall.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel, callHash));
            loggedData[callHash] = {
                recipient,
                amount: amount.toLocaleString(),
                sender,
                relayBlockUnlock: actualBlock,
                callHash,
                callData,
                status: "Sending",
                finalizedBlock: "unknown",
            };
            lastKeyInLoggedData = callHash;
            addLog([
                `Sending time release`,
                `<b>Recipient</b>: <code>${recipient}</code>`,
                `<b>Amount</b>: <code>${amount.toLocaleString()}</code>`,
                `<b>Sender</b>: <code>${sender}</code>`,
                ...logIt],
                txLabel);
            await sending;
        }

    } catch (e) {
        addLog(e.toString(), `${txLabel} ERROR`);
        inProgress(false);
    }
}

// Function for after the transaction has been submitted
const postTransaction = (prefix, callHash) => (status) => {
    const txHash = status.txHash.toHex();
    // Move it over to the txHash
    if (loggedData[callHash]) {
        loggedData[txHash] = loggedData[callHash];
        delete loggedData[callHash];
        lastKeyInLoggedData = txHash;
    }
    // Log the transaction status
    if (status.isInBlock) {
        addLog(`Transaction <code>${txHash}</code> included at block hash <code>${status.status.asInBlock.toHuman()}</code>`, prefix);
        loggedData[txHash]["status"] = "In Block";
    } else if (status.isFinalized) {
        const finalizedBlock = status.status.asFinalized.toHuman();
        addLog(`Transaction <code>${txHash}</code> <b>finalized</b> at block hash<code>${finalizedBlock}</code>`, prefix);
        loggedData[txHash]["status"] = "Finalized";
        loggedData[txHash]["finalizedBlock"] = finalizedBlock;
        inProgress(false);
    } else if (status.isError) {
        addLog(`Transaction error: ${status.status.toHuman()}`, prefix);
        loggedData[txHash]["status"] = `Error: ${status.status.toHuman()}`;
        inProgress(false);
    } else if (status.status.isReady) {
        loggedData[txHash]["status"] = "Sent";
    } else if (status.status.isBroadcast) {
        loggedData[txHash]["status"] = "Broadcast";
    } else {
        const msg = typeof status.status.toHuman() === "string" ? status.status.toHuman() : JSON.stringify(status.status.toHuman());
        loggedData[txHash]["status"] = msg;
        addLog(`Transaction status: ${msg}`, prefix);
    }
}

// Post node connection, connect to the wallet
async function postConnect() {
    await web3Enable("Time Release Transfer Helper");
    const accounts = await web3Accounts();

    const senderSelect = document.getElementById("sender");
    // Clear existing options
    senderSelect.innerHTML = "";

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.text = "Select One";
    senderSelect.add(emptyOption);

    // Add options for each account
    for (const account of accounts) {
        const option = document.createElement("option");
        const address = encodeAddress(account.address, getPrefix());
        option.value = address;
        option.text = `${account.meta.name} (${address})` || address;
        senderSelect.add(option);
    }
    await updateBlockNumber();
}

// Simple display of a new log
function addLog(msg, prefix) {
    prefix = prefix ? prefix + ": " : "";
    if (typeof msg === "string") {
        msg = [msg];
    }

    const li = document.createElement("li");
    const ul = document.createElement("ul");

    let head = msg.shift();
    li.innerHTML = `${(new Date()).toLocaleString()} - ${prefix}${head}`;

    while (head = msg.shift()) {
        const liHead = document.createElement("li");
        liHead.innerHTML = head;
        ul.append(liHead);
    }

    li.append(ul);

    document.getElementById("log").prepend(li);
}

// Simple function to allow getting data out into a spreadsheet paste-able form
const copyToSpreadsheet = (type = "all") => () => {
    let first = true;
    let logData = [];
    let elId = "copyToSpreadsheet";
    if (type === "last") {
        first = false;
        logData = (lastKeyInLoggedData && loggedData[lastKeyInLoggedData]) ? [loggedData[lastKeyInLoggedData]] : [];
        elId = "copyToSpreadsheetLast";
    } else {
        logData = Object.values(loggedData);
    }
    const list = logData.flatMap((v) => {
        const row = Object.values(v);
        if (first) {
            first = false;
            const header = Object.keys(v);
            return [header, row]
        }
        return [row];
    });
    navigator.clipboard.writeText(list.map(x => x.join("\t")).join("\n"));
    const label = document.getElementById(elId).innerHTML;
    document.getElementById(elId).innerHTML = "Copied!";
    setTimeout(() => { document.getElementById(elId).innerHTML = label; }, 2000);
}

// Simple loading and button blocker
function inProgress(isInProgress) {
    const spinner = document.getElementById("txProcessing");
    const submitButton = document.getElementById("createTransferButton");
    if (isInProgress) {
        submitButton.disabled = true;
        spinner.style.display = "block";
    } else {
        submitButton.disabled = false;
        spinner.style.display = "none";
    }
}

// Update the various derived values from fields
function triggerUpdates() {
    updateBlockNumber();
    updateUnitValues();
    updateSenderBalance();
    multisigProcess(false);
}

// Start this up with event listeners
function init() {
    document.getElementById("amount").addEventListener("input", updateUnitValues);
    document.getElementById("transferForm").addEventListener("submit", createTransfer);
    document.getElementById("copyTemplate").addEventListener("click", (e) => {
        e.preventDefault();
        const template = ["Label", "Recipient", "Amount", "Date", "Multisig Participant 1", "Multisig Participant 2", "Multisig Participant 3"];
        navigator.clipboard.writeText(template.join("\t"));
        document.getElementById("copyTemplate").innerHTML = "Copied!";
        setTimeout(() => { document.getElementById("copyTemplate").innerHTML = "Copy Template"; }, 2000);
    })
    document.getElementById("unlockDate").addEventListener("input", updateBlockNumber);
    document.getElementById("sender").addEventListener("change", () => {
        updateSenderBalance();
        multisigProcess(false);
    });
    document.getElementById("txLabel").addEventListener("paste", async (e) => {
        // Get the clipboard data as plain text
        const text = (e.clipboardData || (await navigator.clipboard.readText())).getData('text/plain');

        const values = text.split("\t");
        if (values.length >= 4) {
            e.preventDefault();
            // Populate the form fields from the clipboard data
            populateFromPaste(values);
        }
    });
    document.getElementById("multisigSignatories").addEventListener("input", () => multisigProcess(false));
    document.getElementById("multisigThreshold").addEventListener("input", () => multisigProcess(false));
    document.getElementById("copyToSpreadsheet").addEventListener("click", copyToSpreadsheet("all"));
    document.getElementById("copyToSpreadsheetLast").addEventListener("click", copyToSpreadsheet("last"));
    document.getElementById("clearLog").addEventListener("click", () => {
        document.getElementById("log").innerHTML = "";
        loggedData = {};
        lastKeyInLoggedData = null;
    });
    triggerUpdates();
    initConnection(postConnect);
}

init();
