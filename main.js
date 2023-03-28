import { WsProvider, ApiPromise } from 'https://cdn.jsdelivr.net/npm/@polkadot/api@10.2.1/+esm';
import { checkAddress, encodeAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/util-crypto@10.2.1/+esm';
import { web3Accounts, web3Enable, web3FromAddress } from 'https://cdn.jsdelivr.net/npm/@polkadot/extension-dapp@0.45.3/+esm';

const PREFIX = 42;

let singletonApi;

async function loadApi(providerUri) {
    if (!providerUri && singletonApi) return singletonApi;
    const provider = new WsProvider(providerUri);
    singletonApi = await ApiPromise.create({ provider });
    await singletonApi.isReady;
    const { specVersion, specName, chain } = await singletonApi.rpc.system.chain();
    console.log({ specVersion, specName, chain });
    return singletonApi;
}

async function updateBalance() {
    const balanceDisplay = document.getElementById("balance");
    balanceDisplay.innerHTML = "...";
    const sender = document.getElementById("sender").value;
    const api = await loadApi();
    const resp = await api.query.system.account(sender);
    const balance = resp.data.free.toString();

    if (balance === "0") {
        balanceDisplay.innerHTML = "0.0";
    } else if (balance.length >= 8) {
        balanceDisplay.innerHTML = `${balance.slice(0, -8)}`;
    } else {
        balanceDisplay.innerHTML = `0.${balance.slice(-8).padStart(8, '0')}`;
    }
}

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

    const currentBlockNumber = 14832916;
    const currentBlockDate = new Date("2023-03-27 21:14:06Z");

    // Get the timestamp for noon UTC on the given date
    const noonUTC = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));

    // Calculate the estimated block number for noon UTC on the given date
    const estimatedBlockNumber = currentBlockNumber + Math.round((+noonUTC - +currentBlockDate) / 1000 / 6);
    estimateDisplay.value = estimatedBlockNumber;

    return estimatedBlockNumber;
}

function updateUnitValues() {
    const amountInput = document.getElementById("amount");
    const amount = Number(amountInput.value);
    const unitDisplay = document.getElementById("unit");
    const milliUnitDisplay = document.getElementById("milliunit");

    // Update UNIT display
    const unitValue = amount / 1e8;
    unitDisplay.textContent = `${unitValue.toFixed(8)} UNIT`;

    // Update milliUNIT display
    const milliUnitValue = amount / 1e5;
    milliUnitDisplay.textContent = `${milliUnitValue.toFixed(5)} mUNIT`;
}

function populateFromPaste(csvString) {
    // [label,recipient,amount,date]
    const [label, recipient, amount, date] = csvString.split("\t").map(x => x.trim());

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

async function createTransfer(event) {
    event.preventDefault();
    const sender = document.getElementById("sender").value;
    const txLabel = document.getElementById("txLabel").value;
    let recipient = document.getElementById("recipient").value;
    const amount = document.getElementById("amount").value;
    const estimatedBlock = document.getElementById("estimatedBlock").value;

    if (!sender || !checkAddress(recipient, PREFIX)[0] || amount < 100 || estimatedBlock < 100) {
        alert("Invalid values");
        return;
    }

    recipient = encodeAddress(recipient, PREFIX);

    const api = await loadApi();

    // Create the schedule
    const schedule = {
        start: estimatedBlock,//api.registry.createType("BlockNumber", api.genesisHash),
        period: 1, //api.registry.createType("BlockNumber", vestingPeriod),
        periodCount: 1,
        perPeriod: api.registry.createType("Balance", amount),
    };

    const tx = api.tx.timeRelease.transfer(recipient, schedule);
    const injector = await web3FromAddress(sender);
    debugger;
    try {
        const sending = tx.signAndSend(sender, { signer: injector.signer }, postTransaction(txLabel));
        addLog(`${txLabel}: Sending time release to ${recipient} for ${amount} from ${sender}.`);
        await sending;
    } catch (e) {
        addLog(e.toString());
    }
}

const postTransaction = (prefix) => (status) => {
    // Log the transaction status
    if (status.isInBlock) {
        addLog(`${prefix}: Transaction (${status.txHash.toHex()}) included at block number ${status.status.asInBlock.toHuman()}`);
    } else if (status.isFinalized) {
        addLog(`${prefix}: Transaction (${status.txHash.toHex()}) finalized at block hash ${status.status.asFinalized.toHuman()}`);
    } else if (status.isError) {
        addLog(`${prefix}: Transaction error: ${status.status.toHuman()}`);
    } else {
        const msg = typeof status.status.toHuman() === "string" ? status.status.toHuman() : JSON.stringify(status.status.toHuman());
        addLog(`${prefix}: Transaction status: ${msg}`);
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
    emptyOption.disabled = true;
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

function addLog(msg) {
    const li = document.createElement("li");
    li.innerHTML = `${Date.now().toLocaleString()} - ${msg}`;
    document.getElementById("log").appendChild(li);
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
        e.preventDefault();
        // Get the clipboard data as plain text
        const text = (e.clipboardData || (await navigator.clipboard.readText())).getData('text/plain');

        // Populate the form fields from the clipboard data
        populateFromPaste(text);
    });
    triggerUpdates();
}

init();
