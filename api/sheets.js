// api/sheets.js
const { google } = require('googleapis');

export default async function handler(req, res) {
  try {
    // We pass the Google Sheet ID via the URL, e.g. /api/sheets?id=1A2B3C...
    const { id, range } = req.query;

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        // This regex handles newline characters properly in Vercel
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Fetch the raw data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: range || 'Sheet1', // Make sure this matches your tab name!
    });

    // Google returns a 2D array of rows: [ ["Deal ID", "Name"], ["123", "Site A"] ]
    res.status(200).json(response.data.values);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
