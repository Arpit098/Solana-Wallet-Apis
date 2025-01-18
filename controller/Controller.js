const { Keypair, Connection, clusterApiUrl, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL, SystemProgram } = require('@solana/web3.js');
const bs58 = require('bs58'); 
const bip39 = require('bip39'); 
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createTransferInstruction, getOrCreateAssociatedTokenAccount } = require('@solana/spl-token');
const pool = require('../db');
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

const ADMIN_PUBLIC_KEY = new PublicKey('2sq89gpksHK7mAtsMNb3iqJt3dxw1Ykv2SbiXYzQ1GCw')

let FEEPAYER_KEY = '5U1WiuTWynwm95qZSmoxTJA3VJ3gPbuCyLP153GE1Xfv2vJSpB8A6ixYafXV24fqwzeQKdGRvDehCt2KjhWfNaVW';
FEEPAYER_KEY = FEEPAYER_KEY.replace(/\s/g, '');
// Decode the Base58-encoded private key string
const array = bs58.default.decode(FEEPAYER_KEY); // Remove .default if using newer bs58 versions
// Create the keypair from the decoded private key
const FEEPAYER_KEYPAIR = Keypair.fromSecretKey(array);
const MINT_ADDRESS = {
    ETH: 'Fb98oU1s54j2keETgEoLchcwBssFazMovEGJty9QZzxQ',
    MATIC: 'SfiWoxTSeqNLX7efAmigSDFWJverfvoqzHBCSARExqU',
    BTC: 'HpyCMAYz9XQC4qkJcLHNwFYasxmahs3ZX99rh8cutR46',
    XRP: '6pUKSq43ddg2mBnMckoCXQhMcn2Hzs6tsyeeWFKF8zXE',
}
async function getCryptoPrice(cryptoId, vsCurrency = 'usd') {
    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${vsCurrency}`
        );
        const data = await response.json();
        return data[cryptoId][vsCurrency];
    } catch (error) {
        console.error(`Error fetching ${cryptoId} to ${vsCurrency} price: ${error}`);
    }
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
    const { publicKey} = req.body;

    if (!publicKey) {
        return res.status(400).json({ error: 'Public key is required' });
    }
    // if (!network || !['devnet', 'testnet', 'mainnet-beta'].includes(network)) {
    //     return res.status(400).json({ error: 'Valid network is required (devnet, testnet, mainnet-beta)' });
    // }

    try {
        const connection = new Connection(clusterApiUrl("devnet"));
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
                    // Get recent transaction signatures for the account
                    const signatures = await connection.getSignaturesForAddress(
                        accountInfo.accountId,
                        { limit: 1 }
                    );
                  
                    if (signatures.length === 0) return;
        
                    // Check if the transaction hash already exists in the database
                    const existingTx = await pool.query(
                        'SELECT tx_hash FROM wallet_nfttransaction WHERE tx_hash = $1',
                        [signatures[0].signature]
                    );
                    if (existingTx.rows.length > 0) return;
        
                    // Fetch the transaction details
                    const transaction = await connection.getTransaction(signatures[0].signature, {
                        maxSupportedTransactionVersion: 0
                    });
        
                    if (!transaction) return;
        
                    // Check if the wallet is the recipient in the transaction
                    const recipientIndex = transaction.meta?.postTokenBalances?.findIndex(
                        (balance) =>
                            balance.owner === walletPublicKey.toBase58() &&
                            balance.uiTokenAmount.uiAmount > 0
                    );
        
                    if (recipientIndex === -1) return; // Skip if wallet is not the recipient
        
                    const timestamp = transaction.blockTime
                        ? new Date(transaction.blockTime * 1000).toISOString()
                        : null;
        
                    const result = await pool.query(
                        'SELECT uuid FROM wallet_solanawallets WHERE wallet_public_key = $1',
                        [walletPublicKey.toString()]
                    );
                    const uuid = result.rows[0]?.uuid;
        
                    if (
                        transaction.meta &&
                        transaction.meta.preTokenBalances &&
                        transaction.meta.postTokenBalances
                    ) {
                        const tokenTransferred = Math.abs(transaction.meta.preTokenBalances[0].uiTokenAmount.uiAmount - transaction.meta.postTokenBalances[0].uiTokenAmount.uiAmount);

        
                        const mintAddress = transaction.meta.postTokenBalances[recipientIndex]?.mint;
        
                        console.log('Tokens transferred:', tokenTransferred);
        
                        let tokenSymbol, tokenPrice;
        
                        if (MINT_ADDRESS.ETH === mintAddress) {
                            tokenSymbol = 'ETH';
                            tokenPrice = await getCryptoPrice('ethereum', 'usd');
                            console.log('ETH Price:', tokenPrice);
                            pool.query('UPDATE wallet_solanawallets SET eth = $1 WHERE wallet_public_key = $2', [tokenTransferred, walletPublicKey.toString()]);
                        } else if (MINT_ADDRESS.BTC === mintAddress) {
                            tokenSymbol = 'BTC';
                            tokenPrice = await getCryptoPrice('bitcoin', 'usd');
                            console.log('BTC Price:', tokenPrice);
                            pool.query('UPDATE wallet_solanawallets SET btc = $1 WHERE wallet_public_key = $2', [tokenTransferred, walletPublicKey.toString()]);

                        } else if (MINT_ADDRESS.XRP === mintAddress) {
                            tokenSymbol = 'XRP';
                            tokenPrice = await getCryptoPrice('ripple', 'usd');
                            pool.query('UPDATE wallet_solanawallets SET xrp = $1 WHERE wallet_public_key = $2', [tokenTransferred, walletPublicKey.toString()]);
                        } else if (MINT_ADDRESS.MATIC === mintAddress) {
                            tokenSymbol = 'MATIC';
                            tokenPrice = await getCryptoPrice('matic-network', 'usd');
                            pool.query('UPDATE wallet_solanawallets SET matic = $1 WHERE wallet_public_key = $2', [tokenTransferred, walletPublicKey.toString()]);
                        } else {
                            return; // Skip if the token is not recognized
                        }
        
                        // Insert the transaction details into the database
                        await pool.query(
                            'INSERT INTO wallet_nfttransaction (tx_hash, from_address, value, token, usd_value, timestamp, to_address_id, status, web3) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
                            [
                                signatures[0].signature,
                                transaction.transaction.message.accountKeys[0]?.toString(),
                                tokenTransferred,
                                tokenSymbol,
                                tokenPrice,
                                timestamp,
                                uuid,
                                true,
                                true
                            ]
                        );
        
                        // Perform additional fund transfer logic if needed
                        transferFunds(walletPublicKey.toString(), mintAddress, tokenTransferred, tokenSymbol, tokenPrice, uuid);
                    }
                } catch (error) {
                    console.error('Error processing incoming transaction:', error);
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
                const existingTx = await pool.query(
                    'SELECT tx_hash FROM wallet_nfttransaction WHERE tx_hash = $1',
                    [logs.signature]
                );
                if (existingTx.rows.length > 0) return;
               
                if (transaction) {
                  const from = transaction.transaction.message.accountKeys[0]?.toString() || 'unknown';
                  const timestamp = transaction.blockTime? new Date(transaction.blockTime * 1000).toISOString() : null;
                  
                  let receivedSolAmount = 0;
                 
                  if (transaction.meta.postBalances && transaction.meta.preBalances) {
                    const postBalances = transaction.meta.postBalances;
                    const preBalances = transaction.meta.preBalances;
                    
                    const senderIndex = transaction.transaction.message.accountKeys.findIndex(
                      (key) => key.toString() === walletPublicKey.toString()
                    );
                    const receiverIndex = transaction.transaction.message.accountKeys.findIndex(
                        (key) => key.toString() === walletPublicKey.toString()
                      );
                    if (senderIndex !== -1 && receiverIndex !== -1) {
                      const balanceDifference = preBalances[senderIndex] - postBalances[senderIndex];
                      receivedSolAmount = Math.abs((balanceDifference) / 1e9);
                      if(receivedSolAmount == 0){return} 
                    } else {
                      
                      if (receiverIndex !== -1) {
                        const balanceDifference = postBalances[receiverIndex] - preBalances[receiverIndex];
                        receivedSolAmount = balanceDifference / 1e9; // Convert from lamports to SOL
                      }
                    }
                  }
                  // Correct way:
                  const result = await pool.query('SELECT uuid FROM wallet_solanawallets WHERE wallet_public_key = $1', [walletPublicKey.toString()]);
                  const uuid = result.rows[0]?.uuid;
                  console.log('\nNew SOL Transaction Detected for receiver amount:', receivedSolAmount);
                  pool.query('UPDATE wallet_solanawallets SET balance = $1 WHERE wallet_public_key = $2', [receivedSolAmount, walletPublicKey.toString()]);
                  const solPrice = await getCryptoPrice('solana', 'usd');
                  
                  pool.query('INSERT INTO wallet_nfttransaction (tx_hash, from_address, value, token, usd_value, timestamp, to_address_id, status, web3) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [logs.signature, from, receivedSolAmount, 'SOL', solPrice, timestamp, uuid, true, true]);
                  console.log(logs.signature);
                  transferSOL(walletPublicKey.toString(), receivedSolAmount, solPrice);
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

const transferFunds = async (wallet_publicKey, mintAddress, amount, symbol, price, uuid) => {
    try {
        // Initialize connection and keys
        const mintPubkey = new PublicKey(mintAddress);
        const senderPublickey = new PublicKey(wallet_publicKey);
        
        const connection = new Connection(clusterApiUrl('devnet'), {
            commitment: 'confirmed'
        });

        // Get private key from database
        const result = await pool.query(
            'SELECT wallet_private_key FROM wallet_solanawallets WHERE wallet_public_key = $1',
            [wallet_publicKey]
        );

        if (!result.rows[0]) {
            throw new Error('Wallet not found');
        }

        // Process private key
        let privateKeyString = result.rows[0].wallet_private_key.replace(/\s/g, '');
        const privateKeyArray = bs58.default.decode(privateKeyString);
        if (privateKeyArray.length !== 64) {
            throw new Error('Invalid private key length. Expected 64 bytes.');
        }

        const senderKeypair = Keypair.fromSecretKey(privateKeyArray);

        console.log('Creating/getting sender token account...');
        // Get or create sender token account with explicit error handling
        let senderTokenAccount;
        try {
            senderTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                senderKeypair,
                mintPubkey,
                senderPublickey,
                false,
                'confirmed',
                { commitment: 'confirmed', skipPreflight: false }
            );
            console.log('Sender token account:', senderTokenAccount.address.toString());
        } catch (error) {
            console.error('Error creating sender token account:', error);
            throw new Error(`Failed to create sender token account: ${error.message}`);
        }

        console.log('Creating/getting receiver token account...');
        // Get or create receiver token account with explicit error handling
        let receiverTokenAccount;
        try {
            receiverTokenAccount = await getOrCreateAssociatedTokenAccount(
                connection,
                FEEPAYER_KEYPAIR,
                mintPubkey,
                ADMIN_PUBLIC_KEY,
                false,
                'confirmed',
                { commitment: 'confirmed', skipPreflight: false }
            );
            console.log('Receiver token account:', receiverTokenAccount.address.toString());
        } catch (error) {
            console.error('Error creating receiver token account:', error);
            throw new Error(`Failed to create receiver token account: ${error.message}`);
        }

        // Verify token accounts exist and have proper mint
        console.log('Verifying token accounts...');
        const senderAccountInfo = await connection.getAccountInfo(senderTokenAccount.address);
        const receiverAccountInfo = await connection.getAccountInfo(receiverTokenAccount.address);

        if (!senderAccountInfo || !receiverAccountInfo) {
            throw new Error('Token accounts not properly initialized');
        }

        console.log('Creating transfer instruction...');
        const transferInstruction = createTransferInstruction(
            senderTokenAccount.address,
            receiverTokenAccount.address,
            senderPublickey,
            BigInt(Math.floor(amount * 10 ** 9)), // Scale amount and ensure it's an integer
            [],
            TOKEN_PROGRAM_ID
        ); 
        console.log('Building transaction...');
        const tx = new Transaction();
        tx.add(transferInstruction);
        
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        tx.recentBlockhash = blockhash;
        tx.feePayer = FEEPAYER_KEYPAIR.publicKey;

        console.log('Sending transaction...');
        const signature = await sendAndConfirmTransaction(
            connection,
            tx,
            [senderKeypair, FEEPAYER_KEYPAIR],
            { 
                commitment: 'confirmed',
                skipPreflight: false
            }
        );
        console.log('Transfer successful, transaction signature:', signature);
        pool.query('INSERT INTO wallet_nfttransaction (tx_hash, from_address, value, token, usd_value, timestamp, to_address_id, status, web3) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [signature, senderKeypair.publicKey,  BigInt(Math.floor(amount * 10 ** 9)), symbol, price, new Date(), uuid, true, true]);

        return signature;

    } catch (error) {
        console.error('Error transferring funds:', error);
        throw error;
    }
};

const transferSOL = async (wallet_publicKey, amount, solprice, uuid) => {
    try {
        // Convert amount to lamports (1 SOL = 1e9 lamports)
        console.log("Sol transfer started")
        const lamports = amount * LAMPORTS_PER_SOL;

        // Set up connection
        const connection = new Connection(clusterApiUrl('devnet'), { commitment: 'confirmed' });

        // Get sender's private key from database
        const result = await pool.query(
            'SELECT wallet_private_key FROM wallet_solanawallets WHERE wallet_public_key = $1',
            [wallet_publicKey]
        );
        if (!result.rows[0]) {
            throw new Error('Wallet not found');
        }

        // Clean and decode private key
        let privateKeyString = result.rows[0].wallet_private_key;
        privateKeyString = privateKeyString.replace(/\s/g, '');
        const privateKeyArray = bs58.default.decode(privateKeyString);

        // Create sender's keypair
        const senderKeypair = Keypair.fromSecretKey(privateKeyArray);
        console.log('Sender Public Key:', senderKeypair.publicKey.toBase58());

        // Create transfer instruction
        const transferInstruction = SystemProgram.transfer({
            fromPubkey: senderKeypair.publicKey,
            toPubkey: new PublicKey(ADMIN_PUBLIC_KEY), // Replace with recipient's public key
            lamports: lamports
        });

        // Create transaction
        const transaction = new Transaction();
        transaction.add(transferInstruction);
        // Get recent blockhash and set fee payer
        const { blockhash } = await connection.getLatestBlockhash();
        console.log('Blockhash:', blockhash);
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = FEEPAYER_KEYPAIR.publicKey; // Use the fee payer keypair

        // Check balance of fee payer
        const feePayerBalance = await connection.getBalance(FEEPAYER_KEYPAIR.publicKey);
        console.log('Fee Payer Balance:', feePayerBalance / LAMPORTS_PER_SOL, 'SOL');
        
        // Sign and send transaction
        const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair, FEEPAYER_KEYPAIR], {
            commitment: 'confirmed'
        });

        // Check balance after transfer (optional)
        const balance = await connection.getBalance(senderKeypair.publicKey);
        console.log('Transfer successful, signature:', signature);
        pool.query('INSERT INTO wallet_nfttransaction (tx_hash, from_address, value, token, usd_value, timestamp, to_address_id, status, web3) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [signature, senderKeypair.publicKey,  lamports, 'SOL', solprice, new Date(), uuid, true, true]);

        console.log('Remaining balance:', balance / LAMPORTS_PER_SOL, 'SOL');

    } catch (error) {
        console.error('Error transferring SOL:', error);
       
    }
};


const restartWalletListener = async () => {
    try {
        const connection = new Connection(clusterApiUrl('devnet'), { commitment: 'confirmed' });
        const result = await pool.query('SELECT wallet_public_key FROM wallet_solanawallets');
        const walletAddresses = result.rows.map(row => row.wallet_public_key);
  
        for (const walletAddress of walletAddresses) {
            const publicKey = new PublicKey(walletAddress);

            // Remove the onProgramAccountChange listener for the wallet's public key
            connection.removeAccountChangeListener(
                publicKey, // Correctly use `publicKey` here
                async (accountInfo, context) => {
                    console.log('Disconnected program account listener for wallet:', publicKey.toString());
                },
                'confirmed',
                [
                    {
                        memcmp: {
                            offset: 32,
                            bytes: publicKey.toBase58(), // Correctly use `publicKey` here
                        },
                    },
                ]
            );

            // Remove the onLogs listener for the wallet's public key
            connection.removeOnLogsListener(
                publicKey, // Correctly use `publicKey` here
                async (logs, context) => {
                    console.log('Disconnected logs listener for wallet:', publicKey.toString());
                },
                'confirmed'
            );

            console.log(`Listeners for wallet ${publicKey.toString()} have been removed.`);
            await pool.query('UPDATE wallet_solanawallets SET is_listening = $1 WHERE wallet_public_key = $2', [false, publicKey.toString()]);
            
            // Restart the listener
            startWalletListener({ publicKey: publicKey.toString(), network: 'devnet' });
        }
    } catch (error) {
        console.error('Error removing listeners:', error);
    }
};


const fetchAllTransactions = async (req, res) => {
    try {
      const connection = new Connection(clusterApiUrl('devnet'), {
        commitment: 'confirmed',
      });
  
      const result = await pool.query('SELECT wallet_public_key FROM wallet_solanawallets');
      const walletAddresses = result.rows.map(row => row.wallet_public_key);
  
      for (const walletAddress of walletAddresses) {
        const publicKey = new PublicKey(walletAddress);
        const signatures = await connection.getSignaturesForAddress(publicKey);
  
        for (const signatureInfo of signatures) {
          try {
            const transactionDetails = await connection.getTransaction(signatureInfo.signature, {
              maxSupportedTransactionVersion: 0,
            });
  
            if (!transactionDetails?.meta || !transactionDetails?.transaction?.message?.accountKeys) {
              console.log(`Skipping transaction ${signatureInfo.signature} - Invalid transaction structure`);
              continue;
            }
  
            const { transaction, meta, blockTime } = transactionDetails;
            const accountKeys = transaction.message.accountKeys;
            const from = accountKeys[0]?.toString() || 'unknown';
            const to = accountKeys[1]?.toString() || 'unknown';
            const timestamp = blockTime ? new Date(blockTime * 1000).toISOString() : null;
  
            // Calculate SOL transfer amount
            let receivedSolAmount = 0;
            const { postBalances, preBalances } = meta;
            
            const senderIndex = accountKeys.findIndex(
              (key) => key?.toString() === publicKey.toString()
            );
  
            if (senderIndex !== -1) {
              // This wallet is the sender
              const balanceDifference = (preBalances[senderIndex] || 0) - (postBalances[senderIndex] || 0);
              const fee = meta.fee || 0;
              receivedSolAmount = (Math.abs(balanceDifference) / 1e9); // Negative for outgoing
            } else {
              // Check if this wallet is the receiver
              const receiverIndex = accountKeys.findIndex(
                (key) => key?.toString() === publicKey.toString()
              );
  
              if (receiverIndex !== -1) {
                const balanceDifference = (postBalances[receiverIndex] || 0) - (preBalances[receiverIndex] || 0);
                receivedSolAmount = balanceDifference / 1e9; // Positive for incoming
              }
            }
  
            // Process SPL token transfers if they exist
            let splTokenName = 'SOL';
            let splTokenAmount = 0;
  
            if (meta.preTokenBalances?.length > 0 && meta.postTokenBalances?.length > 0) {
              splTokenAmount = Math.abs(
                meta.preTokenBalances[0]?.uiTokenAmount?.uiAmount - 
                meta.postTokenBalances[0]?.uiTokenAmount?.uiAmount
              );
              
              const mint = meta.postTokenBalances[0]?.mint;
              if (mint) {
                if (mint === MINT_ADDRESS.ETH) splTokenName = 'ETH';
                else if (mint === MINT_ADDRESS.BTC) splTokenName = 'BTC';
                else if (mint === MINT_ADDRESS.XRP) splTokenName = 'XRP';
                else if (mint === MINT_ADDRESS.MATIC) splTokenName = 'MATIC';
              }
            }
  
            // Only log if there's either a SOL transfer or SPL token transfer
            
              console.log({
                transaction: signatureInfo.signature,
                from,
                to,
                timestamp,
                receivedSolAmount,
                splTokenName,
                splTokenAmount
              });
        
  
          } catch (error) {
            console.error(`Error processing transaction ${signatureInfo.signature}:`, error.message);
            continue;
          }
        }
      }
  
      res.status(200).json({
             transaction: signatureInfo.signature,
             from: from,
             to: to,
             timestamp: timestamp,
             value: receivedSolAmount == 0? splTokenAmount: receivedSolAmount,
             splTokenName,
      });
    } catch (error) {
      console.error('Error fetching transactions:', error.message);
      res.status(500).json({
        success: false,
        message: 'Error fetching transactions',
        error: error.message,
      });
    }
  };


module.exports = { createKeypair, getBalance, activateInactiveWallets, fetchAllTransactions, transferSOL, restartWalletListener };

