const web3 = require("@solana/web3.js");
// Airdrop SOL for paying transactions
let payer = web3.Keypair.generate();

console.log("Payer's public key:", payer.publicKey.toBase58());
