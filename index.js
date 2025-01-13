const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const router = require('./routes/Routes');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors()); 
app.use(bodyParser.json());

// Routes
app.use('/api', router);

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
