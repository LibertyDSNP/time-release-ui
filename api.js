import { WsProvider, ApiPromise } from 'https://cdn.jsdelivr.net/npm/@polkadot/api@10.2.2/+esm';


let singletonApi;
let singletonProvider;
let PREFIX = 42;
let UNIT = "UNIT";
let DECIMALS = 8;
let isConnected = false;
let providerUrl = "";

export function getDecimals() { return DECIMALS; }
export function getUnit() { return UNIT; }
export function getPrefix() { return PREFIX; }
export function getIsConnected() { return isConnected; }
export function getProviderUrl() { return providerUrl; }

// Load up the api for the given provider uri
export async function loadApi(providerUri) {
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
    singletonApi = await ApiPromise.create({ provider: singletonProvider, throwOnConnect: true });
    const chain = await singletonApi.rpc.system.properties();
    PREFIX = Number(chain.ss58Format.toString());
    UNIT = chain.tokenSymbol.toHuman();
    DECIMALS = chain.tokenDecimals.toJSON()[0];
    providerUrl = providerUri;
    document.querySelectorAll(".unit").forEach(e => e.innerHTML = UNIT);
    return singletonApi;
}

// Connect to the wallet and blockchain
const connect = (postConnect) => async (event) => {
    event.preventDefault();
    const connectError = document.getElementById("connectError");
    const connectButton = document.getElementById("connectButton");
    connectError.innerHTML = "";
    connectError.style.display = "none";

    connectButton.innerHTML = "Connecting...";
    connectButton.disabled = true;

    let provider = document.getElementById("provider").value;
    if (provider === "custom") {
        provider = document.getElementById("providerCustom").value;
    }
    try {
        await loadApi(provider);
        isConnected = true;
        connectError.innerHTML = "";
        connectError.style.display = "none";
        await postConnect();

        toggleConnectedVisibility(true, provider);
    } catch (_e) {
        connectError.style.display = "block";
        connectError.innerHTML = "Failed to connect. Check the connection URL: " + provider;
    }
    connectButton.innerHTML = "Connect to Node";
    connectButton.disabled = false;
}

// Reset
async function disconnect(event) {
    event.preventDefault();
    const api = await loadApi();
    isConnected = false;
    await api.disconnect();
    toggleConnectedVisibility(false);
}

function customProviderToggle(value = null) {
    value = value ?? document.getElementById("provider").value;
    const customContainer = document.getElementById("providerCustomContainer");
    customContainer.style.display = value === "custom" ? "block" : "none";
}

function toggleConnectedVisibility(isConnected, provider = "...") {
    document.getElementById("currentProvider").innerHTML = provider;
    document.querySelectorAll(".showConnected").forEach(e => e.style.display = isConnected ? "block" : "none");
    document.querySelectorAll(".hideConnected").forEach(e => e.style.display = isConnected ? "none" : "block");
}

export function initConnection(postConnect) {
    document.getElementById("connectButton").addEventListener("click", connect(postConnect));
    document.getElementById("provider").addEventListener("input", (e) => {
        toggleConnectedVisibility(false);
        customProviderToggle(e.target.value);
    });
    document.getElementById("disconnectButton").addEventListener("click", disconnect);
    customProviderToggle();
}

let relayBlockNumberCache = [0, null];
export async function getCurrentRelayChainBlockNumber() {
    const [cacheTime, cachedNumber] = relayBlockNumberCache;
    if ((cacheTime + 60_000) > Date.now()) {
        return cachedNumber;
    }
    const relayEndpoint = {
        42: "wss://rococo-rpc.polkadot.io",
        90: "wss://rpc.polkadot.io",
    };

    const api = await ApiPromise.create({ provider: new WsProvider(relayEndpoint[PREFIX]) });
    await api.isReady;
    const blockData = await api.rpc.chain.getBlock();
    const result = await blockData.block.header.number.toNumber();
    relayBlockNumberCache = [Date.now(), result];
    return result;
}

// Balance to decimal UNIT
export function toDecimalUnit(balance) {
    const DECIMALS = getDecimals();
    // Some basic formatting of the bigint
    balance = balance.toString();
    if (balance.length >= DECIMALS) {
        return `${BigInt(balance.slice(0, -DECIMALS)).toLocaleString()}.${balance.slice(-DECIMALS)}`;
    }

    return balance > 0 ? (Number(balance) / (10 ** DECIMALS)).toLocaleString(undefined, { minimumFractionDigits: DECIMALS }) : "0";
}
