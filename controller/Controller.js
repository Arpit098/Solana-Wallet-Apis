const { Keypair, Connection, clusterApiUrl, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58'); 
const bip39 = require('bip39'); 
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

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


const startWalletListener = async (req, res) => {
    const { publicKey, network } = req.body;

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
        const tokenProgramPublicKey = new PublicKey(SPL_TOKEN_PROGRAM_ID);

        console.log(`Listening to wallet: ${publicKey} on ${network}`);

        // Fetch all associated token accounts for the wallet
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
            programId: tokenProgramPublicKey,
        });

        const associatedTokenAccounts = tokenAccounts.value.map(account => account.pubkey.toString());

        console.log(`Associated Token Accounts: ${associatedTokenAccounts}`);

        // Listen to all transactions involving the wallet (SOL transactions)
        connection.onLogs(
            walletPublicKey,
            (logs, context) => {
                console.log('\nNew SOL Transaction Detected:');
                console.log('Transaction logs:', logs.logs);
                console.log('Signature:', logs.signature);
                console.log('Slot:', context.slot);
            },
            'confirmed'
        );

        // Listen to SPL Token transactions
        connection.onLogs(
            tokenProgramPublicKey,
            (logs, context) => {
                const logString = logs.logs.join('\n');

                // Check if any of the wallet's associated token accounts appear in the logs
                const isWalletInvolved = associatedTokenAccounts.some(account => logString.includes(account));

                if (isWalletInvolved) {
                    console.log('\nNew SPL Token Transaction Detected:');
                    console.log('Transaction logs:', logs.logs);
                    console.log('Signature:', logs.signature);
                    console.log('Slot:', context.slot);
                }
            },
            'confirmed'
        );

        res.status(200).json({ message: `Started listening to wallet: ${publicKey} on ${network}` });
    } catch (error) {
        console.error('Error in wallet listener:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { createKeypair, getBalance, startWalletListener };

