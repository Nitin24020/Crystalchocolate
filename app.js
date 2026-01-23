
const db = require("./data/db.json"); 
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const shortid = require('shortid');
const session = require('express-session');
const ejs = require('ejs');
const htmlPdf = require('html-pdf-node');


const DATA_FILE = path.join(__dirname, 'data', 'db.json');

function readData(){
  if (!fs.existsSync(DATA_FILE)) {
    return { categories: [], products: [], banners: [], orders: [] };
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}
function writeData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

function buildCartItems(req, DB) {
  let items = [];

  for (let pid in req.session.cart.items) {
    const p = DB.products.find(x => x.id == pid);
    if (!p) continue;

    const qty = req.session.cart.items[pid];
    const pieces = qty * p.cartoon_size;

    items.push({
      product: p,
      qty,
      pieces,
      total: pieces * p.price
    });
  }

  return items;
}

function sendCartJSON(req, res, key) {
  const items = req.session.cart.items;
  const products = req.session.cart.products;

  let subtotal = 0;

  for (let k in items) {
    const p = products[k];
    subtotal += items[k] * p.cartoon_size * p.price;
  }

  if (!items[key]) {
    return res.json({
      qty: 0,
      totalPieces: 0,
      lineTotal: 0,
      subtotal,
      total: subtotal
    });
  }

  const qty = items[key];
  const prod = products[key];

  res.json({
    qty,
    totalPieces: qty * prod.cartoon_size,
    lineTotal: qty * prod.cartoon_size * prod.price,
    subtotal,
    total: subtotal,
    image: prod.image
  });
}


function getNextId(list) {
  if (!list || list.length === 0) return 1;
  return Math.max(...list.map(i => i.id)) + 1;
}



// STATIC FILES
app.use(express.static(path.join(__dirname, 'public')));
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(path.join(__dirname, 'public', 'uploads')));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({ secret: 'sweetshop-secret', resave: false, saveUninitialized: true }));

// multer setup
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, uploadDir); },
  filename: function (req, file, cb) {
    const id = shortid.generate();
    const ext = path.extname(file.originalname);
    cb(null, id + ext);
  }
});
const upload = multer({ storage: storage });


// LOAD or INIT DATA
let DB = readData();
if (!DB.categories) DB = { categories: [], products: [], banners: [], orders: [] };

// Sample data
if (DB.categories.length === 0) {
  DB.categories.push({ id: 1, name: 'Chocolates' });
  DB.categories.push({ id: 2, name: 'Gift Packs' });
}
if (DB.products.length === 0) {
  DB.products.push({ id: 1, name: 'Melted Milk Chocolate', category:1, description:'Delicious milk chocolate', price:120, cartoon_size:20, image:'/media/placeholder-product.png', stock:20 });
  DB.products.push({ id: 2, name: 'Dark Chocolate Box', category:1, description:'Assorted dark chocolates', price:250, cartoon_size:20, image:'/media/placeholder-product.png', stock:10 });
}
if (DB.banners.length === 0) {
  DB.banners.push({ id:1, title:'Welcome Banner', image:'/media/placeholder-banner.png' });
}
writeData(DB);


// CART COUNT HELPER
function initCart(req) {
  if (!req.session.cart) {
    req.session.cart = { category: null, items: {} };
  }
}

function getCartCount(req) {
  if (!req.session.cart) return 0;
  return Object.values(req.session.cart.items).reduce((s, v) => s + v, 0);
}

// HOME PAGE
app.get("/", (req, res) => {
  const DB = readData();

  let bestProducts = {};
  DB.categories.forEach(cat => {
      bestProducts[cat.id] = DB.products.find(p => p.category === cat.id);
  });

  const topSelling = DB.products.slice(0, 4);

  res.render("home", {
      cartCount: getCartCount(req),
      categories: DB.categories,
      bestProducts: bestProducts,
      topSelling: topSelling
  });
});


// PRODUCT LIST PAGE
app.get("/products", (req, res) => {
  const DB = readData();
  const category = req.query.category || "";

  // ✅ SORT CATEGORIES BY ADMIN DRAG ORDER
  const sortedCategories = DB.categories.sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0)
  );

  let products = DB.products;

  // ✅ FILTER + SORT PRODUCTS INSIDE CATEGORY
  if (category) {
    products = products
      .filter(p => p.category == category)
      .sort((a, b) => a.name.localeCompare(b.name)); // alphabetical
  }

  res.render("products", {
    products,
    categories: sortedCategories, // ← IMPORTANT
    category,
    cart_count: getCartCount(req),
  });
});



// PRODUCT DETAIL PAGE

app.get("/product/:id", (req, res) => {
  const DB = readData();
  const id = parseInt(req.params.id);

  const product = DB.products.find(p => p.id === id);
  if (!product) return res.redirect("/products");

  res.render("product_detail", {
    product,
    fromCategory: req.query.fromCategory || null,
    cart_count: getCartCount(req)
  });
});


app.post("/add-full-carton/:categoryId", (req, res) => {
  const DB = readData();
  const categoryId = req.params.categoryId;
  initCart(req);

  const productsInCategory = DB.products.filter(p => p.category == categoryId);

  if (productsInCategory.length === 0) {
    return res.json({ success: false, message: "No products in this category" });
  }

  // PICK RANDOM PRODUCT FROM CATEGORY
  const product = productsInCategory[Math.floor(Math.random() * productsInCategory.length)];

  const key = "category_" + categoryId; // category-based cart key
  req.session.cart.items[key] = (req.session.cart.items[key] || 0) + 1;
  req.session.cart.products = req.session.cart.products || {};

  // update product info every time (dynamic image)
  req.session.cart.products[key] = {
    categoryName: DB.categories.find(c => c.id == categoryId).name,
    image: product.image,
    price: product.price,
    cartoon_size: product.cartoon_size
  };

  res.json({ success: true, cartCount: getCartCount(req) });
});



app.get("/cart", (req, res) => {
  initCart(req);

  const items = [];
  let subtotal = 0;

  const cartItems = req.session.cart.items || {};
  const cartProducts = req.session.cart.products || {};

  for (let key in cartItems) {
    const qty = cartItems[key];
    const prod = cartProducts[key];
    if (!prod) continue;

    const cartonSize = prod.cartoon_size;
    const totalPieces = cartonSize * qty;
    const lineTotal = totalPieces * prod.price;

    subtotal += lineTotal;

    items.push({
      key,
      name: prod.categoryName,
      image: prod.image,
      qty,
      cartonSize,
      totalPieces,
      price: prod.price,
      lineTotal
    });
  }

  res.render("cart", {
    items,
    subtotal,
    total: subtotal,
    cart_count: getCartCount(req)
  });
});


// INCREMENT QTY
app.post("/cart/inc/:key", (req, res) => {
  initCart(req);
  const key = req.params.key;

  req.session.cart.items[key] = (req.session.cart.items[key] || 0) + 1;

  const categoryId = parseInt(key.split("_")[1]);
  const DB = readData();

  const productsInCategory = DB.products.filter(p => p.category == categoryId);
  const product = productsInCategory[Math.floor(Math.random() * productsInCategory.length)];

  req.session.cart.products[key] = {
    categoryName: DB.categories.find(c => c.id == categoryId).name,
    image: product.image,
    price: product.price,
    cartoon_size: product.cartoon_size
  };

  sendCartJSON(req, res, key);
});


// DECREMENT QTY
app.post("/cart/dec/:key", (req, res) => {
  initCart(req);
  const key = req.params.key;

  if (req.session.cart.items[key] > 1) {
    req.session.cart.items[key] -= 1;

    const categoryId = parseInt(key.split("_")[1]);
    const DB = readData();

    const productsInCategory = DB.products.filter(p => p.category == categoryId);
    const product = productsInCategory[Math.floor(Math.random() * productsInCategory.length)];

    req.session.cart.products[key] = {
      categoryName: DB.categories.find(c => c.id == categoryId).name,
      image: product.image,
      price: product.price,
      cartoon_size: product.cartoon_size
    };
  } else {
    delete req.session.cart.items[key];
    delete req.session.cart.products[key];
  }

  sendCartJSON(req, res, key);
});


app.post("/cart/remove/:key", (req, res) => {
  initCart(req);
  const key = req.params.key;

  delete req.session.cart.items[key];
  delete req.session.cart.products[key];

  res.redirect("/cart");
});

app.post("/cart/clear", (req, res) => {
  // Reset the cart completely
  req.session.cart = {
    category: null,
    items: {},
    products: {}  // clear stored product info (images, category names, prices)
  };
  res.redirect("/cart");
});


app.post("/place-order", (req, res) => {
  console.log("✅ PLACE ORDER HIT");
  const DB = readData();
  initCart(req);

  const cartItems = req.session.cart.items;
  const cartProducts = req.session.cart.products;

  if (!cartItems || Object.keys(cartItems).length === 0) {
    req.session.errorMsg = "❌ Your cart is empty!";
    return res.redirect("/cart");
  }

  const { name, phone, pincode, city, state } = req.body;

  // ---------- VALIDATION ----------
  if (
    !/^[A-Za-z ]{3,}$/.test(name.trim()) ||
    !/^[0-9]{10}$/.test(phone.trim()) ||
    !/^[0-9]{6}$/.test(pincode.trim()) ||
    !/^[A-Za-z ]{2,}$/.test(city.trim()) ||
    !/^[A-Za-z ]{2,}$/.test(state.trim())
  ) {
    req.session.errorMsg = "❌ Please enter valid customer details";
    return res.redirect("/cart");
  }

  let orderItems = [];
  let subtotal = 0;

  for (let key of Object.keys(cartItems)) {
    const qty = cartItems[key];
    const prodInCart = cartProducts[key];

    if (!prodInCart) continue;

    // Find actual product in DB to deduct stock
    const product = DB.products.find(
      p => p.image === prodInCart.image && p.category === parseInt(key.split("_")[1])
    );

    if (!product) {
      req.session.errorMsg = `❌ Product not found for cart key ${key}`;
      return res.redirect("/cart");
    }

    if (qty > product.stock) {
      req.session.errorMsg = `❌ Not enough stock for "${product.categoryName}". Available cartons: ${product.stock}`;
      return res.redirect("/cart");
    }

    const totalPieces = qty * prodInCart.cartoon_size;
    const lineTotal = totalPieces * prodInCart.price;

    product.stock -= qty; // deduct cartons from stock
    subtotal += lineTotal;

    orderItems.push({
      productId: product.id,
      categoryId: product.category,
      name: product.categoryName,
      image: prodInCart.image,
      qty,
      cartoon_size: prodInCart.cartoon_size,
      price: prodInCart.price,
      totalPieces,
      total: lineTotal
    });
  }

  const order = {
    id: shortid.generate(),
    customer: name.trim(),
    phone: phone.trim(),
    address: { pincode: pincode.trim(), city: city.trim(), state: state.trim() },
    items: orderItems,
    subtotal,
    total: subtotal,
    date: new Date().toISOString(),
    status: "Pending"
  };

  DB.orders.push(order);
  writeData(DB);

  // ✅ CLEAR CART
  req.session.cart = { category: null, items: {}, products: {} };
  req.session.errorMsg = null;

  console.log("✅ ORDER PLACED:", order);
  res.render("order_confirm", { order, cart_count: 0 });
});


// ADMIN LOGIN
const ADMIN_USER = { username: 'admin', password: 'admin123' };

app.get('/admin', (req,res)=>{
  res.render('admin_login', { error: null });
});
app.post('/admin/login', (req,res)=>{
  const { username, password } = req.body;
  if (username===ADMIN_USER.username && password===ADMIN_USER.password){
    req.session.admin = true;
    return res.redirect('/admin/dashboard');
  }
  res.render('admin_login', { error: 'Invalid credentials' });
});
app.get('/admin/logout', (req, res) => {
  req.session.admin = false;
  req.session.destroy(() => {
    res.redirect('/');   // Redirect to HOME PAGE
  });
});


function requireAdmin(req,res,next){
  if (!req.session.admin) return res.redirect('/admin');
  next();
}


// ADMIN PAGES
app.get('/admin/dashboard', requireAdmin, (req, res) => {
  const DB = readData();

  const productsByCategory = DB.categories.map(cat => ({
    category: cat,
    products: DB.products.filter(p => p.category === cat.id)
  }));

  res.render('admin_dashboard', {
    productsByCategory,
    products: DB.products || [],
    categories: DB.categories || [],
    orders: DB.orders || [],
    
  });
});

  


// Add Product
app.get('/admin/products/new', requireAdmin, (req,res)=>{
  DB = readData();

  // ✅ Sort categories by admin order
  const sortedCategories = DB.categories.sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));

  res.render('admin_product_form', { 
    product: null, 
    categories: sortedCategories, 
    action: '/admin/products/new' 
  });
});

app.post('/admin/products/new', requireAdmin, upload.single('image'), (req,res)=>{
  DB = readData();
  const id = getNextId(DB.products);
  const img = req.file ? '/media/' + req.file.filename : '/media/placeholder-product.png';

  DB.products.push({ 
    id, 
    name: req.body.name, 
    category: parseInt(req.body.category), 
    description: req.body.description, 
    price: parseFloat(req.body.price||0), 
    cartoon_size: parseInt(req.body.cartoon_size||20), 
    image: img, 
    stock: parseInt(req.body.stock||0) 
  });

  writeData(DB);
  res.redirect('/admin/dashboard');
});


app.post('/admin/categories/new', requireAdmin, (req, res) => {
  const DB = readData();   // ✅ reload latest DB

  // find max sort_order
  const maxOrder = DB.categories.reduce(
    (a, b) => Math.max(a, b.sort_order || 0),
    0
  );

  // generate new id
  const newId =
    DB.categories.length > 0
      ? Math.max(...DB.categories.map(c => c.id)) + 1
      : 1;

  // push new category
  DB.categories.push({
    id: newId,
    name: req.body.name.trim(),
    sort_order: maxOrder + 1
  });

  writeData(DB);           // ✅ SAVE TO FILE

  res.redirect('/admin/dashboard');
});



// GET Add Category Page
app.get('/admin/categories/new', requireAdmin, (req, res) => {
  const DB = readData();
  res.render('add_category', { 
    action: '/admin/categories/new', 
    categories: DB.categories.sort((a,b) => a.sort_order - b.sort_order)
  });
});


app.post('/admin/categories/delete/:id', requireAdmin, (req, res) => {
  const DB = readData();
  const id = parseInt(req.params.id);

  // Remove category
  DB.categories = DB.categories.filter(c => c.id !== id);

  // Optional: remove all products in this category
  DB.products = DB.products.filter(p => p.category != id);

  writeData(DB);
  res.redirect('/admin/categories/new');
});

app.post('/admin/categories/reorder', requireAdmin, (req, res) => {
  const DB = readData();
  const order = req.body;

  order.forEach(o => {
    const cat = DB.categories.find(c => c.id == o.id);
    if (cat) cat.sort_order = o.sort_order;
  });

  writeData(DB);
  res.json({ success: true });
});



app.get("/admin/orders", requireAdmin, (req, res) => {
  const DB = readData();
  let orders = DB.orders || [];

  // Sort newest → oldest
  orders.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Determine selected date
  let selectedDate = req.query.date;

  // If no date is selected, default to today
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (!selectedDate) {
    selectedDate = todayStr;
  }

  // Filter orders based on selectedDate
  let filteredOrders;
  if (selectedDate === "all") {
    filteredOrders = orders; // Show all orders
  } else {
    filteredOrders = orders.filter(o =>
      String(o.date).startsWith(selectedDate)
    );
  }

  // ENRICH ITEMS WITH CATEGORY NAME
  filteredOrders = filteredOrders.map(order => {
    const enrichedItems = (order.items || []).map(it => {
      const category = DB.categories.find(c => c.id === it.categoryId);
      return {
        ...it,
        categoryName: category ? category.name : "N/A",
      };
    });
    return { ...order, items: enrichedItems };
  });

  res.render("admin_orders", {
    orders: filteredOrders,
    selectedDate,
    totalCount: filteredOrders.length
  });
});



app.get("/admin/orders/:id/bill", requireAdmin, (req, res) => { 
  const DB = readData();
  const order = DB.orders.find(o => o.id == req.params.id);

  if (!order) return res.send("Order not found");

  // ENRICH ITEMS WITH CATEGORY NAME
  const enrichedItems = (order.items || []).map(it => {
    const category = DB.categories.find(c => c.id === it.categoryId);
    return {
      ...it,
      categoryName: category ? category.name : "N/A"
    };
  });

  order.items = enrichedItems;

  // LOGO
  const logoPath = path.join(__dirname, "public","images", "logo.jpg");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");

  res.render("admin_bill", {
    order,
    logoBase64,
    isPDF: false
  });
});




app.get("/admin/orders/:id/bill/pdf", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const filename = req.query.filename || "invoice";

  const DB = readData();
  const order = DB.orders.find(o => o.id == id);

  if (!order) return res.send("Order not found");

  // ENRICH ITEMS WITH CATEGORY NAME
  const enrichedItems = (order.items || []).map(it => {
    const category = DB.categories.find(c => c.id === it.categoryId);
    return {
      ...it,
      categoryName: category ? category.name : "N/A"
    };
  });

  order.items = enrichedItems;

  // LOGO
  const logoPath = path.join(__dirname, "public","images","logo.jpg");
  const logoBase64 = fs.readFileSync(logoPath).toString("base64");

  // Render HTML (with isPDF = true)
  const html = await ejs.renderFile("views/admin_bill.ejs", {
    order,
    logoBase64,
    isPDF: true
  });

  // Create PDF
  const file = { content: html };
  const pdf = await htmlPdf.generatePdf(file, { format: "A4" });

  res.setHeader("Content-Disposition", `attachment; filename=${filename}.pdf`);
  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
});


// --- ADMIN REPORTS ---
app.get('/admin/reports', requireAdmin, (req, res) => {
  const DB = readData();
  const orders = DB.orders || [];

  // --- SALES CALCULATIONS ---
  const totalSales = orders.reduce((sum, o) => sum + o.total, 0);
  const totalOrders = orders.length;
  const totalItemsSold = orders.reduce((sum, o) => sum + o.items.reduce((s, it) => s + it.qty, 0), 0);

  const today = new Date().toISOString().split("T")[0];
  const todayRevenue = orders.filter(o => o.date.startsWith(today)).reduce((sum, o) => sum + o.total, 0);

  // BEST SELLING
  let bestSelling = {};
  orders.forEach(order => {
    order.items.forEach(it => {
      if (!bestSelling[it.name]) bestSelling[it.name] = { qty: 0, total: 0 };
      bestSelling[it.name].qty += it.qty;
      bestSelling[it.name].total += it.total;
    });
  });
  bestSelling = Object.entries(bestSelling).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  // CATEGORY SALES
  let categorySales = {};
  (DB.categories || []).forEach(cat => categorySales[cat.name] = 0);
  orders.forEach(order => {
    order.items.forEach(it => {
      const p = DB.products.find(x => x.id === it.productId);
      if (p) {
        const cat = DB.categories.find(c => c.id === p.category);
        if (cat) categorySales[cat.name] += it.total;
      }
    });
  });

  // LOW STOCK PRODUCTS
  const lowStock = (DB.products || []).filter(p => p.stock <= 5);

  // RENDER REPORTS PAGE
  res.render("reports", {
    totalSales,
    totalOrders,
    totalItemsSold,
    todayRevenue,
    bestSelling,
    categorySales,
    lowStock,
    orders
  });
});

// --- EXPORT CSV (SEPARATE ROUTE) ---
app.get("/admin/reports/export-csv", requireAdmin, (req, res) => {
  const DB = readData();
  const orders = DB.orders || [];

  let csv = "OrderID,Customer,Total,Date\n";
  orders.forEach(o => {
    csv += `${o.id},${o.customer},${o.total},${o.date}\n`;
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=report.csv");
  res.send(csv);
});



// ADMIN VIEW MESSAGES
const messagesFile = path.join(__dirname, "data", "messages.json");

// Admin: view messages
app.get("/admin/messages", requireAdmin, (req, res) => {
  const messagesFile = path.join(__dirname, "data/messages.json");
  let messages = [];

  if (fs.existsSync(messagesFile)) {
    messages = JSON.parse(fs.readFileSync(messagesFile));
  }

  res.render("admin_messages", { messages });
});


app.get("/admin/products/:id/edit", requireAdmin, (req, res) => {
  let DB = readData();
  const productId = parseInt(req.params.id);

  const product = DB.products.find(p => p.id === productId);
  if (!product) return res.send("Product not found");

  const sortedCategories = DB.categories.sort((a,b) => (a.sort_order || 0) - (b.sort_order || 0));

  res.render("admin_edit_product", {
    product,
    categories: sortedCategories
  });
  
});

app.post("/admin/products/:id/edit",
  requireAdmin,
  upload.single("image"),
  (req, res) => {

  let DB = readData();

  const product = DB.products.find(p => p.id == req.params.id);
  if (!product) return res.send("Product not found");

  const { name, description, category, price, stock, cartoon_size, image_url } = req.body;

  let image = product.image;

  if (req.file) {
    image = "/media/" + req.file.filename;
  } else if (image_url && image_url.trim()) {
    image = image_url.trim();
  }

  product.name = name;
  product.description = description;
  product.category = parseInt(category);
  product.price = Number(price);
  product.stock = Number(stock);
  product.cartoon_size = Number(cartoon_size);
  product.image = image;

  writeData(DB);
  res.redirect("/admin/dashboard");
});

app.get("/admin/products/:id/delete", requireAdmin, (req, res) => {
  let DB = readData();
  const productId = parseInt(req.params.id);

  DB.products = DB.products.filter(p => p.id !== productId);

  writeData(DB);

  res.redirect("/admin/dashboard");
});

// ABOUT PAGE
app.get("/about", (req, res) => {
  res.render("about");
});

// CONTACT PAGE
app.get("/contact", (req, res) => {
  res.render("contact");
});

// POST FORM (optional)


app.post("/contact", (req, res) => {
  const messagesFile = path.join(__dirname, "data/messages.json");
  const { name, email, message } = req.body;

  // Read existing messages
  let messages = [];
  if (fs.existsSync(messagesFile)) {
    messages = JSON.parse(fs.readFileSync(messagesFile));
  }

  // Add new message
  messages.push({
    id: Date.now(), // simple unique id
    name,
    email,
    message,
    date: new Date().toLocaleString()
  });

  // Save back to file
  fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));

  res.render("contact", { success: true });
});


// START SERVER
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
