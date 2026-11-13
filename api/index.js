// ==============================================================================
// Vercel Serverless Function Handler
// TIHC Dissemination Monitoring & Reporting Platform
// Technical Schools of the Chamber of Heraklion (TIHC)
// ==============================================================================

const requestHandler = require('../server');

module.exports = async (req, res) => {
  return requestHandler(req, res);
};

