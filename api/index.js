// ==============================================================================
// Vercel Serverless Function Handler
// TIHC Dissemination Monitoring & Reporting Platform
// Technical Schools of the Chamber of Heraklion (TIHC)
// ==============================================================================

module.exports = async (req, res) => {
  try {
    const rawUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const originalPath = rawUrl.searchParams.get('__path') ||
                         req.headers['x-matched-path'] ||
                         req.headers['x-forwarded-uri'] ||
                         req.headers['x-vercel-matched-path'];
    if (originalPath && originalPath.startsWith('/api')) {
      const search = rawUrl.search || '';
      req.url = originalPath.split('?')[0] + search;
    }
    const requestHandler = require('../server');
    return await requestHandler(req, res);
  } catch (err) {
    console.error('Serverless Handler Error:', err);
    res.writeHead(500, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      error: 'Serverless Handler Initialization Error',
      message: err.message
    }));
  }
};
