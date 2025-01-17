const express = require('express');
const { createKeypair, getBalance, activateInactiveWallets, fetchAllTransactions, transferSOL } = require('../controller/Controller');

const router = express.Router();

// Route to create a new keypair
router.get('/createKeypair', createKeypair);
router.get('/getBalance', getBalance);
router.get('/activateInactiveWallets', activateInactiveWallets);
router.get('/getTransactions', fetchAllTransactions);
router.get('/transact', transferSOL)
module.exports = router;
