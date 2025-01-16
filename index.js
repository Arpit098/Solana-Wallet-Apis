const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const router = require('./routes/Routes');

const pool = require('./db');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors()); 
app.use(bodyParser.json());

// Routes
app.use('/api', router);

const fetchWallets = async () => {
  try {
    const result = await pool.query('SELECT * FROM wallet_solanawallets');
    if (result.rows.length > 0) {
      console.log('Wallets:', result.rows.length); // Logs the count of wallets
    }
    return result.rows; // Return the fetched rows
  } catch (error) {
    console.error('Error fetching data:', error.message);
    throw error; // Rethrow the error for further handling
  }
};

// Call the function to fetch data
fetchWallets()
  .then(data => {
    console.log('Fetched Wallet Data:', data); // Logs the actual wallet data
  })
  .catch(err => {
    console.error('Error:', err); // Logs any error that occurs
  });

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
