const { ethers } = require('ethers');

// WebSocket provider for Polygon Amoy
const providerPol = new ethers.WebSocketProvider('wss://polygon-amoy.infura.io/ws/v3/a546c2401d5f4136905fb8df361495e6');
console.log("Polygon WebSocket provider initialized.");

// WebSocket provider for BSC (Update to use BSC WebSocket)
// const providerBSC = new ethers.WebSocketProvider('wss://bsc-testnet.g.alchemy.com/v2/84VKNcFdexpWswKa054Yrk1GRKqEI-UC');
// console.log("BSC WebSocket provider initialized.");

// Replace with your private key and wallet setup
const privateKey = 'f100626c8f911edb05182fe021adfe3bf457d16c722f41c5159a1e11c4218a8d';
// const walletBSC = new ethers.Wallet(privateKey, providerBSC);
const walletPol = new ethers.Wallet(privateKey, providerPol);

const targetAddress = '0x4676bbA81229BF143048907a8C1b27be7Da18d00'; // Replace with recipient address

// Keep track of the last processed transaction to avoid duplicates
// let lastProcessedBscTxHash = null;
let lastProcessedPolTxHash = null;

async function sendTokensPolygon(amount) {
    const gasPricePol = ((await providerPol.getFeeData()).gasPrice);
 
    const tx = {
        to: targetAddress,
        value: ethers.parseEther(amount.toString()), // Use the received amount
        gasLimit: 21000,
        gasPrice: gasPricePol,
    };

    try {
        const txResponse = await walletPol.sendTransaction(tx);
        console.log(`Transaction sent on Polygon with hash: ${txResponse.hash}`);
        await txResponse.wait(); // Wait for transaction to be mined
        console.log('Transaction on Polygon mined');
    } catch (error) {
        console.error('Error sending tokens on Polygon:', error);
    }
}

// Listen for pending transactions on Polygon
providerPol.on('pending', async (txHash) => {
    try {
        const tx = await providerPol.getTransaction(txHash);

        // If the transaction is to your wallet and is a new transaction
        if (tx && tx.to && tx.to.toLowerCase() === walletPol.address.toLowerCase() && txHash !== lastProcessedPolTxHash) {
            const amountReceived = ethers.formatEther(tx.value); // Convert amount from wei
            console.log(`Incoming Polygon transaction: ${txHash}, Amount: ${amountReceived}`);

            // Send the equivalent amount to the target address
            await sendTokensPolygon(amountReceived);

            // Update the last processed transaction hash
            lastProcessedPolTxHash = txHash;
        }
    } catch (error) {
        console.error('Error processing Polygon transaction:', error);
    }
});