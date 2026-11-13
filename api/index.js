// ==============================================================================
// Vercel Serverless Function Handler
// TIHC Dissemination Monitoring & Reporting Platform
// Technical Schools of the Chamber of Heraklion (TIHC)
// ==============================================================================

module.exports = async (req, res) => {
  try {
    const requestHandler = require('../server');
    return await requestHandler(req, res);
  } catch (err) {
    console.error('Serverless Handler Error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'Serverless Handler Initialization Error',
      message: err.message
    }));
  }
};
