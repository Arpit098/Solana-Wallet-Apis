const express = require('express');
const { createKeypair, getBalance, activateInactiveWallets } = require('../controller/Controller');

const router = express.Router();

// Route to create a new keypair
router.get('/createKeypair', createKeypair);
router.get('/getBalance', getBalance);
router.get('/activateInactiveWallets', activateInactiveWallets);

module.exports = router;
