import { WsProvider, ApiPromise } from 'https://cdn.jsdelivr.net/npm/@polkadot/api@10.2.1/+esm';
import { checkAddress, encodeAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/util-crypto@10.2.1/+esm';
import { web3Accounts, web3Enable, web3FromAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/extension-dapp@0.45.3/+esm';

let PREFIX = 42;
let UNIT = "UNIT";

let singletonApi;

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
    const estimateDisplay = document.getElementById("estimatedBlock");
    estimateDisplay.value = null;

    if (!(date instanceof Date)) {
        date = new Date(Date.parse(document.getElementById("unlockDate").value));
    }

    // Reject old dates and bad dates
    if (!date || date < Date.now()) {
        return;
    }

    // Lock it down to this pinpoint
    const currentBlockNumber = 14832916;
    const currentBlockDate = new Date("2023-03-27 21:14:06Z");

    // Get the timestamp for noon UTC on the given date
    const noonUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));

    // Calculate the estimated block number for noon UTC on the given date (6s block time)
    const estimatedBlockNumber = currentBlockNumber + Math.round((+noonUTC - +currentBlockDate) / 1000 / 6);
    estimateDisplay.value = estimatedBlockNumber;

    return estimatedBlockNumber;
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

// Do the actual transfer
async function createTransfer(event) {
    event.preventDefault();
    const sender = document.getElementById("sender").value;
    const txLabel = document.getElementById("txLabel").value;
    let recipient = document.getElementById("recipient").value;
    const amount = parseInt(document.getElementById("amount").value);
    const estimatedBlock = document.getElementById("estimatedBlock").value;
    const addressCheck = checkAddress(recipient, PREFIX);
    if (!addressCheck[0]) {
        alert(`Recipient address invalid: ${addressCheck[1] || "unknown"}`);
        return;
    }

    recipient = encodeAddress(recipient, PREFIX);

    const api = await loadApi();

    // Create the schedule
    const schedule = {
        start: estimatedBlock,
        period: 1, // Must be > 0, but we want to have just a one time thing.
        periodCount: 1, // Must be > 0, but we want to have just a one time thing.
        perPeriod: api.registry.createType("Balance", amount),
    };

    try {
        const tx = api.tx.timeRelease.transfer(recipient, schedule);
        const injector = await web3FromAddress(sender);
        const sending = tx.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel));
        addLog(`Sending time release to <code>${recipient}</code> for ${amount.toLocaleString()} from <code>${sender}</code>.`, txLabel);
        await sending;
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

function addLog(msg, prefix) {
    prefix = prefix ? prefix + ": " : "";
    const li = document.createElement("li");
    li.innerHTML = `${(new Date()).toLocaleString()} - ${prefix}${msg}`;
    document.getElementById("log").prepend(li);
}

function triggerUpdates() {
    updateBlockNumber();
    updateUnitValues();
    updateBalance();
}

async function init() {
    await loadApi(document.getElementById("provider").value);
    document.getElementById("amount").addEventListener("input", updateUnitValues);
    document.getElementById("transferForm").addEventListener("submit", createTransfer);
    document.getElementById("connectButton").addEventListener("click", connect);
    document.getElementById("unlockDate").addEventListener("input", updateBlockNumber);
    document.getElementById("sender").addEventListener("change", updateBalance);
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
    triggerUpdates();
}

init();
