const express = require('express');
const { createKeypair, getBalance, startWalletListener } = require('../controller/Controller');

const router = express.Router();

// Route to create a new keypair
router.get('/createKeypair', createKeypair);
router.get('/getBalance', getBalance);
router.get('/startWalletListener', startWalletListener);


module.exports = router;
