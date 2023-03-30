import { WsProvider, ApiPromise } from 'https://cdn.jsdelivr.net/npm/@polkadot/api@10.2.1/+esm';
import { checkAddress, createKeyMulti, encodeAddress, blake2AsHex } from 'https://cdn.jsdelivr.net/npm/@polkadot/util-crypto@10.2.1/+esm';
import { web3Accounts, web3Enable, web3FromAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/extension-dapp@0.45.3/+esm';

let PREFIX = 42;
let UNIT = "UNIT";

let singletonApi;

const RELAY_CHAIN_TIME = {
    "90": { // Polkadot
        block: 14885653,
        date: new Date("2023-03-31 13:12:30Z"),
    },
    "42": { // Rococo and local
        block: 4752207,
        date: new Date("2023-03-31 13:13:12Z"),
    }
}

// Load up the api for the given provider uri
async function loadApi(providerUri) {
    if (!providerUri && singletonApi) return singletonApi;
    const provider = new WsProvider(providerUri);
    singletonApi = await ApiPromise.create({ provider });
    await singletonApi.isReady;
    const chain = await singletonApi.rpc.system.properties();
    PREFIX = Number(chain.ss58Format.toString());
    UNIT = chain.tokenSymbol.toHuman();
    document.querySelectorAll(".unit").forEach(e => e.innerHTML = UNIT);
    return singletonApi;
}

// Update the balance display
async function updateBalance() {
    const balanceDisplay = document.getElementById("balance");
    balanceDisplay.innerHTML = "...";
    const sender = document.getElementById("sender").value;
    const api = await loadApi();
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
async function updateBlockNumber(date) {
    const estimateDisplay = document.getElementById("actualBlock");
    estimateDisplay.value = null;

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
    const noonUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));

    // Calculate the estimated block number for noon UTC on the given date (6s block time)
    const actualBlockNumber = currentBlockNumber + Math.round((+noonUTC - +currentBlockDate) / 1000 / 6);
    estimateDisplay.value = actualBlockNumber;

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
    const [label, recipient, amount, date] = data.map(x => x.trim());

    // Populate the form fields
    const txLabel = document.getElementById('txLabel');
    txLabel.value = label;

    const recipientInput = document.getElementById('recipient');
    recipientInput.value = recipient;

    const amountInput = document.getElementById('amount');
    amountInput.value = amount;

    const unlockDate = document.getElementById('unlockDate');
    unlockDate.value = date;
    triggerUpdates();
}

function multisigProcess(doAlert = false) {
    document.getElementById("multisigAddress").value = "...";
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
                    return;
                }
            });

            const multisigAddress = encodeAddress(createKeyMulti(multisigSignatories, multisigThreshold), PREFIX);
            document.getElementById("multisigAddress").value = multisigAddress;
            return [multisigAddress, multisigThreshold, multisigSignatories];
        } catch (e) {
            if (doAlert) alert(`Multisig setup is invalid. Wrong threshold or bad signatories: ${e.toString()}`);
            return;
        }
    }
    return;
}

// Do the actual transfer
async function createTransfer(event) {
    event.preventDefault();
    const sender = document.getElementById("sender").value;
    const txLabel = document.getElementById("txLabel").value;
    let recipient = document.getElementById("recipient").value;
    const amount = parseInt(document.getElementById("amount").value);
    const actualBlock = document.getElementById("actualBlock").value;
    const addressCheck = checkAddress(recipient, PREFIX);
    if (!addressCheck[0]) {
        alert(`Recipient address invalid: ${addressCheck[1] || "unknown"}`);
        return;
    }

    const isMultisig = document.getElementById("multisigCheckbox").checked;

    const [multisigAddress, multisigThreshold, multisigSignatories] = isMultisig ? multisigProcess(true) : undefined;

    recipient = encodeAddress(recipient, PREFIX);

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
        const logIt = [
            `<b>Parameters</b>: <code>Start: ${actualBlock}, Period: 1, Period Count: 1, Per Period: ${amount}</code>`,
            `<b>Call Hash</b>: <code>${blake2AsHex(callData)}</code>`,
            `<b>Call Data</b>: <code>${callData}</code>`,
        ];

        if (isMultisig) {
            const maxWeight = {
                weight: 1_000_000_000,
            }
            const tx = api.tx.multisig.asMulti(multisigThreshold, multisigSignatories.filter(x => x != sender), null, transferCall, maxWeight);
            const sending = tx.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel));
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
            const sending = transferCall.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel));
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
    }
}

// Function for after the transaction has been submitted
const postTransaction = (prefix) => (status) => {
    // Log the transaction status
    if (status.isInBlock) {
        addLog(`Transaction <code>${status.txHash.toHex()}</code> included at block hash <code>${status.status.asInBlock.toHuman()}</code>`, prefix);
    } else if (status.isFinalized) {
        addLog(`Transaction <code>${status.txHash.toHex()}</code> finalized at block hash<code>${status.status.asFinalized.toHuman()}</code>`, prefix);
    } else if (status.isError) {
        addLog(`Transaction error: ${status.status.toHuman()}`, prefix);
    } else {
        const msg = typeof status.status.toHuman() === "string" ? status.status.toHuman() : JSON.stringify(status.status.toHuman());
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
        option.value = account.address;
        option.text = `${account.meta.name} (${account.address})` || account.address;
        senderSelect.add(option);
    }

    document.getElementById("transferForm").style.display = "block";
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

// Update the various derived values from fields
function triggerUpdates() {
    updateBlockNumber();
    updateUnitValues();
    updateBalance();
    multisigProcess(false);
}

// Start this up with event listeners
async function init() {
    document.getElementById("amount").addEventListener("input", updateUnitValues);
    document.getElementById("transferForm").addEventListener("submit", createTransfer);
    document.getElementById("connectButton").addEventListener("click", connect);
    document.getElementById("unlockDate").addEventListener("input", updateBlockNumber);
    document.getElementById("sender").addEventListener("change", () => {
        updateBalance();
        multisigProcess(false);
    });
    document.getElementById("provider").addEventListener("input", () => { document.getElementById("transferForm").style.display = "none"; });
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
    triggerUpdates();
}

init();
