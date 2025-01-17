const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const router = require('./routes/Routes');
const {restartWalletListener} = require('./controller/Controller');
const pool = require('./db');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors()); 
app.use(bodyParser.json());

// Routes
app.use('/api', router);

// const fetchWallets = async () => {
//   try {
//     const result = await pool.query('SELECT * FROM wallet_nfttransaction'); // Query to fetch all wallets
//     if (result.rows.length > 0) {
//       console.log('Wallets:', result.rows.length); // Logs the count of wallets
//     }
//     return result.rows; // Return the fetched rows
//   } catch (error) {
//     console.error('Error fetching data:', error.message);
//     throw error; // Rethrow the error for further handling
//   }
// };

// // Call the function to fetch data
// fetchWallets()
//   .then(data => {
//     console.log('Fetched Wallet Data:', data); // Logs the actual wallet data
//   })
//   .catch(err => {
//     console.error('Error:', err); // Logs any error that occurs
//   });

//   async function fetchTableStructure() {
//     try {
//         // First query to get column names and their types
        
//     } catch (error) {
//         console.error('Error fetching table structure:', error);
//     } finally {
//         pool.end();
//     }
// }

// fetchTableStructure();


//   async function getCryptoPrice(cryptoId, vsCurrency = 'usd') {
//     try {
//         const response = await fetch(
//             `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoId}&vs_currencies=${vsCurrency}`
//         );
//         const data = await response.json();
//         return data[cryptoId][vsCurrency];
//     } catch (error) {
//         console.error(`Error fetching ${cryptoId} to ${vsCurrency} price: ${error}`);
//     }
// }

// // Example usage:
// (async () => {
//     const bitcoinPrice = await getCryptoPrice('bitcoin', 'usd');
//     console.log(`Bitcoin Price (USD): $${bitcoinPrice}`);

//     const ethereumPrice = await getCryptoPrice('ethereum', 'usd');
//     console.log(`Ethereum Price (USD): $${ethereumPrice}`);

//     const maticPrice = await getCryptoPrice('matic-network', 'usd');
//     console.log(`MATIC Price (USD): $${maticPrice}`);

//     const xrpPrice = await getCryptoPrice('ripple', 'usd');
//     console.log(`XRP Price (USD): $${xrpPrice}`);

//     const solPrice = await getCryptoPrice('solana', 'usd');
// console.log(`SOL Price (USD): $${solPrice}`);
// })();
// Start server
async function fetchTransactionByHash(txHash) {
  try {
      // Query to fetch the row where tx_hash matches the provided value
      const query = `
          SELECT * 
          FROM wallet_nfttransaction 
          WHERE tx_hash = $1
      `;

      // Execute the query
      const result = await pool.query(query, [txHash]);

      // Check if a row was found
      if (result.rows.length === 0) {
          console.log('No transaction found with the provided tx_hash.');
          return null;
      }

      // Return the fetched row
      console.log('Transaction details:', result.rows[0]);
      return result.rows[0];
  } catch (error) {
      console.error('Error fetching transaction:', error);
      throw error;
  }
}

// Example usage
const txHash = '67FcocEXKF6btnK7j2XCfHNY4bAjbf65ufPnerNx9qdvSpurtARR8jENCdo6XSC4sHriT2nSfRAeyRfUhtUaktx';
fetchTransactionByHash(txHash)
  .then((transaction) => {
      if (transaction) {
          console.log('Fetched transaction:', transaction);
      }
  })
  .catch((error) => {
      console.error('Failed to fetch transaction:', error);
  });
restartWalletListener();
app.listen(PORT || 4000, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
