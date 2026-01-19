SweetShop - Node.js + Express (JSON storage) - Ready to run
--------------------------------------------------------

How to run:

1. Install Node.js (16+ recommended).
2. Open terminal and go to project folder:
   cd sweetshop_project
3. Install dependencies:
   npm install
4. Start server:
   npm start
5. Open in browser: http://127.0.0.1:3000

Project features:
- Home page with banner carousel (uses placeholder images)
- Categories and products
- Session-based cart (in memory - cookie session)
- Admin area (simple login) to add/edit products, categories, banners (images are stored into /public/uploads)
- Data persisted in data/db.json (JSON file)

Notes:
- This demo uses simple JSON storage for ease-of-use. For production use a proper DB (MongoDB, PostgreSQL, etc.).
- To reset sample data, delete data/db.json and restart server.
