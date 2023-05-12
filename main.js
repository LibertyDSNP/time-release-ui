import { WsProvider, ApiPromise } from 'https://cdn.jsdelivr.net/npm/@polkadot/api@10.2.2/+esm';
import { checkAddress, createKeyMulti, encodeAddress, blake2AsHex, decodeAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/util-crypto@10.2.2/+esm';
import { web3Accounts, web3Enable, web3FromAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/extension-dapp@0.45.5/+esm';

let PREFIX = 42;
let UNIT = "UNIT";

let singletonApi;
let singletonProvider;

// Simple place to dump log data that is then able to be sent to a clipboard
let loggedData = {};

const RELAY_CHAIN_TIME = {
    "90": { // Polkadot
        seconds: 6,
        block: 15374323,
        date: new Date("2023-05-04T12:21:30.000Z"),
        url: "https://polkadot.subscan.io/block/",
    },
    "42": { // Rococo and local
        seconds: 6,
        block: 5241260,
        date: new Date("2023-05-04T12:19:00.000Z"),
        url: "https://rococo.subscan.io/block/",
    }
}

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

// Load up the api for the given provider uri
async function loadApi(providerUri) {
    // Singleton
    if (!providerUri && singletonApi) return singletonApi;
    // Just asking for the singleton, but don't have it
    if (!providerUri) {
        return null;
    }
    // Handle disconnects
    if (providerUri) {
        if (singletonApi) {
            await singletonApi.disconnect();
        } else if (singletonProvider) {
            await singletonProvider.disconnect();
        }
    }

    // Singleton Provider because it starts trying to connect here.
    singletonProvider = new WsProvider(providerUri);
    singletonApi = await ApiPromise.create({ provider: singletonProvider });

    await singletonApi.isReady;
    const chain = await singletonApi.rpc.system.properties();
    PREFIX = Number(chain.ss58Format.toString());
    UNIT = chain.tokenSymbol.toHuman();
    document.querySelectorAll(".unit").forEach(e => e.innerHTML = UNIT);
    return singletonApi;
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

    // Some basic formatting of the bigint
    if (balance === "0") {
        balanceDisplay.innerHTML = "0.0";
    } else if (balance.length >= 8) {
        balanceDisplay.innerHTML = `${balance.slice(0, -8)}`;
    } else {
        balanceDisplay.innerHTML = `0.${balance.slice(-8).padStart(8, '0')}`;
    }
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

    // Some basic formatting of the bigint
    if (balance === "0") {
        balanceDisplay.innerHTML = "0.0";
    } else if (balance.length >= 8) {
        balanceDisplay.innerHTML = `${balance.slice(0, -8)}`;
    } else {
        balanceDisplay.innerHTML = `0.${balance.slice(-8).padStart(8, '0')}`;
    }
}

// Estimate the block number by date
function updateBlockNumber(date) {
    const estimateDisplay = document.getElementById("actualBlock");
    estimateDisplay.value = null;
    const link = document.getElementById("subscanLink");
    link.style.display = "none";
    inProgress(true);

    if (!(date instanceof Date)) {
        date = new Date(Date.parse(document.getElementById("unlockDate").value));
    }

    // Reject old dates and bad dates
    if (!date || date < Date.now()) {
        return;
    }

    // Lock it down to this pinpoint
    const network = RELAY_CHAIN_TIME[PREFIX];
    if (!network) {
        console.error(`Unable to find relay chain date data for ${PREFIX}`);
        return;
    }
    const currentBlockNumber = network.block;
    const currentBlockDate = network.date;

    // Get the timestamp for noon UTC on the given date
    const noonUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12));

    // Calculate the estimated block number for noon UTC on the given date (6s block time)
    const actualBlockNumber = currentBlockNumber + Math.round((+noonUTC - +currentBlockDate) / 1000 / network.seconds);
    estimateDisplay.value = actualBlockNumber;

    link.href = `${network.url}${actualBlockNumber}`;
    link.style.display = "block";
    inProgress(false);

    return actualBlockNumber;
}

// Input is in Planck, but we want to show the UNIT amount as well
function updateUnitValues() {
    const amountInput = document.getElementById("amount");
    const amount = Number(amountInput.value);
    const unitDisplay = document.getElementById("unit");
    const milliUnitDisplay = document.getElementById("milliunit");

    // Update UNIT display
    const unitValue = amount / 1e8;
    unitDisplay.textContent = `${unitValue.toFixed(8)} ${UNIT}`;

    // Update milliUNIT display
    const milliUnitValue = amount / 1e5;
    milliUnitDisplay.textContent = `${milliUnitValue.toFixed(5)} m${UNIT}`;
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
                const check = checkAddress(signatory, PREFIX);
                if (!check[0]) {
                    if (doAlert) alert(`Signatory address "${signatory}" is invalid: ${check[1] || "unknown"}`);
                }
            });

            const multisigAddress = encodeAddress(createKeyMulti(multisigSignatories, multisigThreshold), PREFIX);
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
    const addressCheck = checkAddress(recipient, PREFIX);
    if (!addressCheck[0]) {
        alert(`Recipient address invalid: ${addressCheck[1] || "unknown"}`);
        return;
    }

    inProgress(true);

    const isMultisig = document.getElementById("multisigCheckbox").checked;

    recipient = encodeAddress(recipient, PREFIX);
    sender = encodeAddress(sender, PREFIX);

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
            const maxWeight = {
                weight: 1_000_000_000,
            }

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

// Connect to the wallet and blockchain
async function connect(event) {
    event.preventDefault();
    await loadApi(document.getElementById("provider").value);
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
        const address = encodeAddress(account.address, PREFIX);
        option.value = address;
        option.text = `${account.meta.name} (${address})` || address;
        senderSelect.add(option);
    }

    document.getElementById("transferForm").style.display = "block";
    document.getElementById("copyToSpreadsheet").style.display = "block";
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
function copyToSpreadsheet() {
    let first = true;
    const list = Object.values(loggedData).flatMap((v) => {
        const row = Object.values(v);
        if (first) {
            first = false;
            const header = Object.keys(v);
            return [header, row]
        }
        return [row];
    });
    navigator.clipboard.writeText(list.map(x => x.join("\t")).join("\n"));
    document.getElementById("copyToSpreadsheet").innerHTML = "Copied!";
    setTimeout(() => { document.getElementById("copyToSpreadsheet").innerHTML = "Copy to Spreadsheet"; }, 2000);
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
    document.getElementById("connectButton").addEventListener("click", connect);
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
    document.getElementById("provider").addEventListener("input", () => {
        document.getElementById("transferForm").style.display = "none";
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
    document.getElementById("copyToSpreadsheet").addEventListener("click", copyToSpreadsheet);
    document.getElementById("clearLog").addEventListener("click", () => {
        document.getElementById("log").innerHTML = "";
        loggedAccountData = {};
    });
    triggerUpdates();
}

init();
