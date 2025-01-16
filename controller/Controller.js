const { Keypair, Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58'); 
const bip39 = require('bip39'); 
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createTransferInstruction, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const pool = require('../db');
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const MINT_ADDRESS = {
    ETH: 'Fb98oU1s54j2keETgEoLchcwBssFazMovEGJty9QZzxQ',
    MATIC: 'SfiWoxTSeqNLX7efAmigSDFWJverfvoqzHBCSARExqU',
    BTC: 'HpyCMAYz9XQC4qkJcLHNwFYasxmahs3ZX99rh8cutR46',
    XRP: '6pUKSq43ddg2mBnMckoCXQhMcn2Hzs6tsyeeWFKF8zXE',
}
const createKeypair = (req, res) => {
    try {
        const keypair = Keypair.generate();
        const seedPhrase = bip39.generateMnemonic();
        res.json({
            publicKey: keypair.publicKey.toString(),
            secretKey: bs58.default.encode(keypair.secretKey),
            seedPhrase
        });
    } catch (error) {
        console.error('Error generating keypair:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
   
};

const activateInactiveWallets = async (req, res) => {

    try {
        // Fetch wallets that are not active
        const result = await pool.query(
            'SELECT wallet_public_key FROM wallet_solanawallets WHERE is_Listening = false'
        );

        for (const { wallet_public_key } of result.rows) {
            console.log(`Activating wallet: ${wallet_public_key}`);

            const networks = ['devnet', 'testnet', 'mainnet-beta'];
            for(const network of networks) {
                startWalletListener({publicKey: wallet_public_key, network});
            }
            // Update the wallet to mark it as active
            await pool.query(
                'UPDATE wallet_solanawallets SET is_Listening = true WHERE wallet_public_key = $1',
                [wallet_public_key]
            );

            console.log(`Wallet marked as active: ${wallet_public_key}`);
        }
    } catch (error) {
        console.error('Error activating inactive wallets:', error);
    } 
};

const getBalance = async (req, res) => {
    const { publicKey, network } = req.body;

    if (!publicKey) {
        return res.status(400).json({ error: 'Public key is required' });
    }
    if (!network || !['devnet', 'testnet', 'mainnet-beta'].includes(network)) {
        return res.status(400).json({ error: 'Valid network is required (devnet, testnet, mainnet-beta)' });
    }

    try {
        const connection = new Connection(clusterApiUrl(network));
        const walletPublicKey = new PublicKey(publicKey);

        // Fetch SOL balance
        const solBalance = await connection.getBalance(walletPublicKey);

        // Fetch associated token accounts (SPL tokens)
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
            programId: new PublicKey(SPL_TOKEN_PROGRAM_ID),
        });

        // Fetch token metadata from Solana Token List
        const tokenListResponse = await fetch(
            'https://raw.githubusercontent.com/solana-labs/token-list/main/src/tokens/solana.tokenlist.json'
        );
        const tokenList = await tokenListResponse.json();
        const tokens = tokenList.tokens;

        // Map SPL token balances with token name
        const splTokenBalances = tokenAccounts.value.map(({ pubkey, account }) => {
            const { mint, owner } = account.data.parsed.info;
            const amount = account.data.parsed.info.tokenAmount;

            return {
                tokenAccount: pubkey.toString(),
                tokenMint: mint,
                owner,
                balance: amount.uiAmount,
                decimals: amount.decimals,
                amountRaw: amount.amount,
                
            };
        });

        res.json({
            publicKey,
            network,
            solBalanceInLamports: solBalance,
            solBalanceInSOL: solBalance / 1e9,
            splTokenBalances,
        });
    } catch (error) {
        console.error('Error fetching balances:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};



const startWalletListener = async ({publicKey, network}) => {

    if (!publicKey) {
        return res.status(404).json({ error: 'Wallet address is required' });
    }

    if (!network || !['devnet', 'testnet', 'mainnet-beta'].includes(network)) {
        return res.status(400).json({ error: 'Valid network is required (devnet, testnet, mainnet-beta)' });
    }

    try {
        const connection = new Connection(clusterApiUrl(network), {
            wsEndpoint: `wss://api.${network}.solana.com`,
            commitment: 'confirmed',
        });

        const walletPublicKey = new PublicKey(publicKey);

        console.log(`Starting listener for wallet: ${publicKey} on ${network}`);
         await pool.query(
            'UPDATE wallet_solanawallets SET is_listening = $1 WHERE wallet_public_key = $2',
            [true, walletPublicKey.toString()]
        );
        connection.onProgramAccountChange(
            new PublicKey(TOKEN_PROGRAM_ID),
            async (accountInfo, context) => {
                try {
                    const signatures = await connection.getSignaturesForAddress(
                        accountInfo.accountId,
                        { limit: 1 }
                    );

                    if (signatures.length > 0) {
                        const transaction = await connection.getTransaction(signatures[0].signature, {
                            maxSupportedTransactionVersion: 0
                        });

                        if (transaction && transaction.meta && transaction.meta.preTokenBalances && transaction.meta.postTokenBalances) {

                            const token_transfered = Math.abs(transaction.meta.preTokenBalances[0].uiTokenAmount.uiAmount - transaction.meta.postTokenBalances[0].uiTokenAmount.uiAmount);
                            console.log("tokens transfered:", token_transfered)

                            if(MINT_ADDRESS.ETH == transaction.meta.postTokenBalances[0].mint){
                                console.log("ETH tokens transfered:", token_transfered)
                                pool.query('UPDATE wallet_solanawallets SET eth = $1 WHERE wallet_public_key = $2', [token_transfered, walletPublicKey.toString()]);
                            }
                            else if(MINT_ADDRESS.BTC == transaction.meta.postTokenBalances[0].mint){
                                console.log("BTC tokens transfered:", token_transfered)
                                pool.query('UPDATE wallet_solanawallets SET btc = $1 WHERE wallet_public_key = $2', [token_transfered, walletPublicKey.toString()]);
                            }
                            else if(MINT_ADDRESS.XRP == transaction.meta.postTokenBalances[0].mint){
                                console.log("XRP tokens transfered:", token_transfered)
                                pool.query('UPDATE wallet_solanawallets SET xrp = $1 WHERE wallet_public_key = $2', [token_transfered, walletPublicKey.toString()]);
                            }
                            else if(MINT_ADDRESS.MATIC == transaction.meta.postTokenBalances[0].mint){
                                console.log("MATIC tokens transfered:", token_transfered)
                                pool.query('UPDATE wallet_solanawallets SET matic = $1 WHERE wallet_public_key = $2', [token_transfered, walletPublicKey.toString()]);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error processing token transfer:', error);
                }
            },
            'confirmed',
            [
                {
                    memcmp: {
                        offset: 32,
                        bytes: walletPublicKey.toBase58()
                    }
                }
            ]
        );

        connection.onLogs(
            walletPublicKey,
            async (logs, context) => {
              try {
                const transaction = await connection.getTransaction(logs.signature, {
                  maxSupportedTransactionVersion: 0,
                });
                console.log('Transaction:', transaction);
          
                if (transaction) {
                  let receivedSolAmount = 0;
                  if (transaction.meta.postBalances && transaction.meta.preBalances) {
                    const postBalances = transaction.meta.postBalances;
                    const preBalances = transaction.meta.preBalances;
                    
                    const senderIndex = transaction.transaction.message.accountKeys.findIndex(
                      (key) => key.toString() === walletPublicKey.toString()
                    );
          
                    if (senderIndex !== -1) {
                      const balanceDifference = preBalances[senderIndex] - postBalances[senderIndex];
                      const fee = transaction.meta.fee;
                      receivedSolAmount = Math.abs((balanceDifference) / 1e9);
                  
                    } else {
                      const receiverIndex = transaction.transaction.message.accountKeys.findIndex(
                        (key) => key.toString() === walletPublicKey.toString()
                      );
          
                      if (receiverIndex !== -1) {
                        const balanceDifference = postBalances[receiverIndex] - preBalances[receiverIndex];
                        receivedSolAmount = balanceDifference / 1e9; // Convert from lamports to SOL
                      }
                    }
                  }
          
                  console.log('\nNew SOL Transaction Detected for receiver amount:', receivedSolAmount);
                  pool.query('UPDATE wallet_solanawallets SET balance = $1 WHERE wallet_public_key = $2', [receivedSolAmount, walletPublicKey.toString()]);
                }
              } catch (error) {
                console.error('Error processing SOL transaction:', error);
              }
            },
            'confirmed'
          );
          
        
    } catch (error) {
        console.error('Error in wallet listener:', error);
    }
};

const transferFunds = async (connection, mintAddress, receiverPublicKey, senderPublicKey, senderPrivateKey, amount) => {
    try {
        // Convert inputs to PublicKey objects
        const mintPubkey = new PublicKey(mintAddress);
        const receiverPubkey = new PublicKey(receiverPublicKey);
        const senderPubkey = new PublicKey(senderPublicKey);
        const senderKeypair = Keypair.fromSecretKey(Uint8Array.from(senderPrivateKey));
        const senderTokenAddress = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, mintPubkey, senderPubkey);
        const receiverTokenAddress = await getOrCreateAssociatedTokenAccount(connection, senderKeypair, mintPubkey, receiverPubkey);

        const transferInstruction = createTransferInstruction(
            senderTokenAddress, 
            receiverTokenAddress,
            senderPubkey, 
            amount,
            TOKEN_PROGRAM_ID
        );

        // Create a transaction
        const tx = new Transaction();
        tx.add(transferInstruction);

        // Send and confirm the transaction
        const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);
        console.log('Transfer successful, transaction signature:', signature);
    } catch (error) {
        console.error('Error transferring funds:', error);
    }
};

const restartListeners = async (req, res) => {
    try {
        // Get all active listening wallets
        const result = await pool.query(
            'SELECT wallet_public_key FROM wallet_solanawallets WHERE is_listening = true'
        );
        console.log(`Found ${result.rows.length} active listeners to restart`);

        const networks = ['devnet', 'testnet', 'mainnet-beta'];
        let successCount = 0;
        let failureCount = 0;

        // Restart each wallet listener one by one
        for (const { wallet_public_key } of result.rows) {
            try {
                console.log(`Restarting listeners for wallet: ${wallet_public_key}`);
                
                // First, disconnect existing listeners for each network
                for (const network of networks) {
                    const connection = new Connection(clusterApiUrl(network), {
                        wsEndpoint: `wss://api.${network}.solana.com`,
                        commitment: 'confirmed',
                    });
                    await disconnectWalletListener(connection, wallet_public_key);
                }

                // Mark wallet as not listening
                await pool.query(
                    'UPDATE wallet_solanawallets SET is_listening = false WHERE wallet_public_key = $1',
                    [wallet_public_key]
                );

                // Brief wait to ensure clean disconnect
                await new Promise(resolve => setTimeout(resolve, 100));

                // Restart listeners for each network
                for (const network of networks) {
                    await startWalletListener({
                        publicKey: wallet_public_key,
                        network
                    });
                }

                successCount++;
                console.log(`Successfully restarted listeners for wallet: ${wallet_public_key}`);
            } catch (error) {
                failureCount++;
                console.error(`Failed to restart listeners for wallet ${wallet_public_key}:`, error);
            }

            // Minimal delay between wallets
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Send response with results
        res.json({
            message: 'Listener restart operation completed',
            totalWallets: result.rows.length,
            successfulRestarts: successCount,
            failedRestarts: failureCount
        });

    } catch (error) {
        console.error('Error in restartListeners:', error);
        res.status(500).json({
            error: 'Failed to restart listeners',
            details: error.message
        });
    }
};


module.exports = { createKeypair, getBalance, activateInactiveWallets };

