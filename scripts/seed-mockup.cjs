const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.resolve(process.cwd(), 'database/tucajero.db');

// ── Categorías ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { name: 'Bebidas',      color: '#3b82f6' },
  { name: 'Abarrotes',    color: '#10b981' },
  { name: 'Lácteos',      color: '#f59e0b' },
  { name: 'Aseo',         color: '#8b5cf6' },
  { name: 'Snacks',       color: '#ef4444' },
  { name: 'Carnes',       color: '#ec4899' },
  { name: 'Panadería',    color: '#f97316' },
  { name: 'Frutas y Verduras', color: '#22c55e' },
  { name: 'Higiene Personal', color: '#06b6d4' },
  { name: 'Mascotas',     color: '#a855f7' },
];

// ── Productos ─────────────────────────────────────────────────────────────────
const PRODUCTS = [
  // Bebidas
  { code: 'BEB001', barcode: '7701234567891', name: 'Coca Cola 2L',          description: 'Gaseosa Coca Cola 2 Litros',              category: 'Bebidas',  price: 6000,  cost: 4500,  stock: 50,  minStock: 10, criticalStock: 5,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'BEB002', barcode: '7701234567892', name: 'Agua Cristal 600ml',   description: 'Agua pura embotellada 600ml',             category: 'Bebidas',  price: 2500,  cost: 1500,  stock: 80,  minStock: 15, criticalStock: 8,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'BEB003', barcode: '7701234567893', name: 'Pony Malta 330ml',     description: 'Malta ámbar en lata 330ml',                category: 'Bebidas',  price: 3200,  cost: 2200,  stock: 60,  minStock: 12, criticalStock: 6,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'BEB004', barcode: '7701234567894', name: 'Colombiana 1.5L',      description: 'Gaseosa sabor kola 1.5 Litros',           category: 'Bebidas',  price: 5000,  cost: 3800,  stock: 40,  minStock: 8,  criticalStock: 4,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'BEB005', barcode: '7701234567895', name: 'Jugo Hit Mora 1L',     description: 'Jugo de frutas sabor mora 1L',             category: 'Bebidas',  price: 4200,  cost: 3100,  stock: 60,  minStock: 12, criticalStock: 4,  taxRate: 0.19, unitType: 'UNIT' },

  // Abarrotes
  { code: 'ABA001', barcode: '7702234567891', name: 'Arroz Roa 1kg',        description: 'Arroz blanco tradicional',                 category: 'Abarrotes', price: 4500,  cost: 3200,  stock: 100, minStock: 20, criticalStock: 10, taxRate: 0,    unitType: 'UNIT' },
  { code: 'ABA002', barcode: '7702234567892', name: 'Azúcar Risaralda 1kg', description: 'Azúcar rubia empacada 1kg',                category: 'Abarrotes', price: 5000,  cost: 3800,  stock: 70,  minStock: 15, criticalStock: 8,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'ABA003', barcode: '7702234567893', name: 'Aceite Chef 900ml',    description: 'Aceite vegetal de soya 900ml',             category: 'Abarrotes', price: 8500,  cost: 6500,  stock: 35,  minStock: 8,  criticalStock: 4,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'ABA004', barcode: '7702234567894', name: 'Sal Refisal 500g',     description: 'Sal refinada iodizada 500g',               category: 'Abarrotes', price: 2200,  cost: 1400,  stock: 45,  minStock: 10, criticalStock: 5,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'ABA005', barcode: '7702234567895', name: 'Fideo Don Nicanor 500g', description: 'Fideo espagueti tradicional 500g',      category: 'Abarrotes', price: 3800,  cost: 2600,  stock: 55,  minStock: 12, criticalStock: 6,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'ABA006', barcode: '7702234567896', name: 'Frijol Bola Roja 500g', description: 'Frijol premium empacado 500g',            category: 'Abarrotes', price: 5500,  cost: 4200,  stock: 25,  minStock: 10, criticalStock: 3,  taxRate: 0,    unitType: 'UNIT' },

  // Lácteos
  { code: 'LAC001', barcode: '7703234567891', name: 'Leche Colanta 1L',     description: 'Bolsa de leche entera 1L',                 category: 'Lácteos',  price: 3800,  cost: 3000,  stock: 40,  minStock: 15, criticalStock: 5,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'LAC002', barcode: '7703234567892', name: 'Queso Campesino 500g', description: 'Queso fresco campesino 500g',             category: 'Lácteos',  price: 9500,  cost: 7500,  stock: 20,  minStock: 8,  criticalStock: 3,  taxRate: 0,    unitType: 'UNIT' },
  { code: 'LAC003', barcode: '7703234567893', name: 'Yogur Alpina 200ml',   description: 'Yogur sabor fresa 200ml',                 category: 'Lácteos',  price: 2800,  cost: 1900,  stock: 48,  minStock: 12, criticalStock: 6,  taxRate: 0,    unitType: 'UNIT' },

  // Aseo
  { code: 'ASE001', barcode: '7704234567891', name: 'Detergente Fab 1kg',   description: 'Detergente en polvo 1kg',                 category: 'Aseo',     price: 8000,  cost: 6000,  stock: 30,  minStock: 8,  criticalStock: 4,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'ASE002', barcode: '7704234567892', name: 'Jabón Personal 150g',  description: 'Jabón de tocador neutro 150g',            category: 'Aseo',     price: 3500,  cost: 2200,  stock: 50,  minStock: 12, criticalStock: 6,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'ASE003', barcode: '7704234567893', name: 'Papel Higiénico 4 rollos', description: 'Papel higiénico doble hoja 4 rollos', category: 'Aseo',     price: 6500,  cost: 4800,  stock: 40,  minStock: 10, criticalStock: 5,  taxRate: 0.19, unitType: 'UNIT' },

  // Snacks
  { code: 'SNK001', barcode: '7705234567891', name: 'Galletas Saltinas 180g', description: 'Galletas saladas tradicionales 180g',   category: 'Snacks',   price: 3200,  cost: 2100,  stock: 35,  minStock: 10, criticalStock: 5,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'SNK002', barcode: '7705234567892', name: 'Papas Margarita 50g',  description: 'Papas fritas sabor limón 50g',            category: 'Snacks',   price: 2500,  cost: 1500,  stock: 60,  minStock: 15, criticalStock: 8,  taxRate: 0.19, unitType: 'UNIT' },
  { code: 'SNK003', barcode: '7705234567893', name: 'Chocoramo 35g',        description: 'Bizcocho con cobertura de chocolate 35g', category: 'Snacks',   price: 1800,  cost: 1100,  stock: 70,  minStock: 15, criticalStock: 8,  taxRate: 0.19, unitType: 'UNIT' },

  // Carnes
  { code: 'CAR001', barcode: '7706234567891', name: 'Pollo Entero 1kg',     description: 'Pollo entero fresco por kilo',             category: 'Carnes',   price: 12000, cost: 9500,  stock: 15,  minStock: 5,  criticalStock: 2,  taxRate: 0,    unitType: 'KG' },
  { code: 'CAR002', barcode: '7706234567892', name: 'Carne Molida 500g',    description: 'Carne molida de res premium 500g',        category: 'Carnes',   price: 18000, cost: 14000, stock: 10,  minStock: 4,  criticalStock: 2,  taxRate: 0,    unitType: 'KG' },
  { code: 'CAR003', barcode: '7706234567893', name: 'Chorizo Santarrosano', description: 'Chorizo artesanal 250g',                  category: 'Carnes',   price: 7500,  cost: 5500,  stock: 20,  minStock: 6,  criticalStock: 3,  taxRate: 0,    unitType: 'UNIT' },

  // Panadería
  { code: 'PAN001', barcode: '7707234567891', name: 'Pan Francés 1u',       description: 'Pan francés recién horneado',              category: 'Panadería', price: 500,   cost: 300,   stock: 100, minStock: 30, criticalStock: 15, taxRate: 0,    unitType: 'UNIT' },
  { code: 'PAN002', barcode: '7707234567892', name: 'Arepa de Maíz 1u',     description: 'Arepa tradicional de maíz',               category: 'Panadería', price: 800,   cost: 450,   stock: 50,  minStock: 15, criticalStock: 8,  taxRate: 0,    unitType: 'UNIT' },

  // Frutas y Verduras
  { code: 'FRU001', barcode: '7708234567891', name: 'Banana 1kg',           description: 'Banana madura por kilo',                  category: 'Frutas y Verduras', price: 3500, cost: 2200, stock: 30, minStock: 10, criticalStock: 5, taxRate: 0, unitType: 'KG' },
  { code: 'FRU002', barcode: '7708234567892', name: 'Tomate 1kg',           description: 'Tomate maduro por kilo',                  category: 'Frutas y Verduras', price: 4500, cost: 3000, stock: 25, minStock: 8,  criticalStock: 4, taxRate: 0, unitType: 'KG' },
  { code: 'FRU003', barcode: '7708234567893', name: 'Cebolla 1kg',          description: 'Cebolla cabezona por kilo',               category: 'Frutas y Verduras', price: 3000, cost: 1800, stock: 20, minStock: 8,  criticalStock: 4, taxRate: 0, unitType: 'KG' },

  // Higiene Personal
  { code: 'HIG001', barcode: '7709234567891', name: 'Pasta Dental Colgate 90g', description: 'Pasta dental sabor menta 90g',        category: 'Higiene Personal', price: 5500, cost: 3800, stock: 25, minStock: 8,  criticalStock: 4, taxRate: 0.19, unitType: 'UNIT' },
  { code: 'HIG002', barcode: '7709234567892', name: 'Shampoo Sedal 375ml',  description: 'Shampoo para todo tipo de cabello 375ml', category: 'Higiene Personal', price: 9500, cost: 7000, stock: 18, minStock: 6,  criticalStock: 3, taxRate: 0.19, unitType: 'UNIT' },

  // Mascotas
  { code: 'MAS001', barcode: '7710234567891', name: 'Dog Chow 1kg',         description: 'Alimento balanceado para perro adulto 1kg', category: 'Mascotas', price: 12000, cost: 9000, stock: 15, minStock: 5, criticalStock: 2, taxRate: 0.19, unitType: 'UNIT' },
];

// ── Clientes ──────────────────────────────────────────────────────────────────
const CUSTOMERS = [
  { document: '1020304050', name: 'Juan Perez',       email: 'juan@ejemplo.com',       phone: '3101234567', address: 'Calle 123 #45-67' },
  { document: '1122334455', name: 'Maria Gomez',      email: 'maria@ejemplo.com',      phone: '3209876543', address: 'Carrera 8 #12-34' },
  { document: '9876543210', name: 'Empresa XYZ',      email: 'ventas@empresaxyz.com',  phone: '3005556677', address: 'Avenida Principal 99' },
  { document: '1098765432', name: 'Pedro Ramirez',    email: 'pedro@ejemplo.com',      phone: '3156789012', address: 'Calle 45 #67-89' },
  { document: '5566778899', name: 'Ana Martinez',     email: 'ana@ejemplo.com',        phone: '3201234567', address: 'Transversal 5 #10-20' },
];

// ── Proveedores ───────────────────────────────────────────────────────────────
const SUPPLIERS = [
  { name: 'Distribuidora Andina',     contactPerson: 'Carlos Silva', phone: '3151112233', email: 'contacto@andina.com',      address: 'Zona Industrial 4',    leadTimeDays: 3, notes: 'Entrega rápida' },
  { name: 'Alimentos Nacionales',     contactPerson: 'Ana Rojas',    phone: '3119998877', email: 'ventas@alimentos.com',     address: 'Bodega 12',            leadTimeDays: 5, notes: 'Pago a 30 días' },
  { name: 'Aseo y Hogar S.A.S.',     contactPerson: 'Luis Torres',  phone: '3187776655', email: 'pedidos@aseohogar.com',    address: 'Parque Industrial',    leadTimeDays: 4, notes: 'Descuentos por volumen' },
  { name: 'Frutas del Valle',         contactPerson: 'Sandra Luna',  phone: '3123334455', email: 'ventas@frutasvalle.com',   address: 'Corregimiento 3',      leadTimeDays: 2, notes: 'Productos frescos diarios' },
];

// ── Pedidos de Compra (referencias a productos por código) ─────────────────────
const PURCHASE_ORDERS = [
  {
    orderNumber: 'PO-2026-001',
    supplier: 'Distribuidora Andina',
    status: 'CONFIRMED',
    items: [
      { productCode: 'BEB001', quantity: 20 },
      { productCode: 'BEB005', quantity: 30 },
      { productCode: 'BEB002', quantity: 40 },
    ],
  },
  {
    orderNumber: 'PO-2026-002',
    supplier: 'Alimentos Nacionales',
    status: 'DRAFT',
    items: [
      { productCode: 'ABA001', quantity: 50 },
      { productCode: 'ABA006', quantity: 40 },
      { productCode: 'ABA002', quantity: 30 },
    ],
  },
];

// ── Seed Principal ─────────────────────────────────────────────────────────────
async function seedMockups() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  try {
    let accountId;

    const adminUser = sqlite.prepare('SELECT id, accountId FROM User WHERE username = ?').get('admin');

    if (!adminUser) {
      console.log('No se encontró el usuario admin. Creando cuenta y usuario admin...');
      const now = new Date().toISOString();
      const bcrypt = require('bcryptjs');
      const hashedPassword = bcrypt.hashSync('admin123', 12);

      const accountResult = sqlite.prepare(
        'INSERT INTO Account (name, nit, email, phone, subscriptionStatus, subscriptionPlan, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('Cuenta Principal', '000000000000', 'local@tucajero.local', '', 'TRIAL', 'BASIC', now, now);

      accountId = Number(accountResult.lastInsertRowid);

      sqlite.prepare(
        'INSERT INTO User (accountId, username, password, fullName, role, active, mustChangePassword, failedLoginAttempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(accountId, 'admin', hashedPassword, 'Administrador', 'ADMIN', 1, 0, 0, now, now);
    } else {
      accountId = adminUser.accountId;
    }

    const now = new Date().toISOString();

    // ── Limpiar datos mockup previos (idempotente) ──────────────────────────
    // Debe ejecutarse ANTES de BEGIN TRANSACTION para poder desactivar foreign_keys
    const existingCategories = sqlite.prepare('SELECT id FROM Category WHERE accountId = ?').all(accountId);
    if (existingCategories.length > 0) {
      console.log('🔄 Limpiando datos mockup previos...');
      sqlite.pragma('foreign_keys = OFF');
      const tablesToClean = [
        'Payment', 'SaleItem', 'PurchaseOrderItem', 'StockMovement', 'CashExpense',
        'Debt', 'Sale', 'CashSession', 'PurchaseOrder',
        'BranchStock', 'Product', 'Category', 'Supplier', 'Customer',
      ];
      for (const table of tablesToClean) {
        try { sqlite.prepare(`DELETE FROM ${table} WHERE accountId = ?`).run(accountId); } catch (_) { /* table may not exist */ }
      }
      sqlite.pragma('foreign_keys = ON');
      console.log('✅ Datos previos eliminados.');
    }

    sqlite.exec('BEGIN TRANSACTION');

    // ── Categorías ──────────────────────────────────────────────────────────
    const catInsert = sqlite.prepare('INSERT INTO Category (accountId, name, color, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
    const categoryIdMap = new Map();

    for (const cat of CATEGORIES) {
      const result = catInsert.run(accountId, cat.name, cat.color, now, now);
      categoryIdMap.set(cat.name, Number(result.lastInsertRowid));
    }
    console.log(`✅ ${CATEGORIES.length} categorías insertadas.`);

    // ── Productos ───────────────────────────────────────────────────────────
    const prodInsert = sqlite.prepare(`
      INSERT INTO Product (accountId, code, barcode, name, description, categoryId, price, cost, stock, minStock, criticalStock, taxRate, unitType, conversionFactor, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const productIdMap = new Map();

    for (const product of PRODUCTS) {
      const categoryId = categoryIdMap.get(product.category);
      if (!categoryId) {
        console.warn(`⚠️  Categoría no encontrada para ${product.name}: ${product.category}`);
        continue;
      }
      const result = prodInsert.run(
        accountId, product.code, product.barcode, product.name, product.description,
        categoryId, product.price, product.cost, product.stock, product.minStock,
        product.criticalStock, product.taxRate, product.unitType, 1, 1, now, now
      );
      productIdMap.set(product.code, Number(result.lastInsertRowid));
    }
    console.log(`✅ ${PRODUCTS.length} productos insertados.`);

    // ── Clientes ────────────────────────────────────────────────────────────
    const custInsert = sqlite.prepare('INSERT INTO Customer (accountId, document, name, email, phone, address, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const cust of CUSTOMERS) {
      custInsert.run(accountId, cust.document, cust.name, cust.email, cust.phone, cust.address, 1, now, now);
    }
    console.log(`✅ ${CUSTOMERS.length} clientes insertados.`);

    // ── Proveedores ─────────────────────────────────────────────────────────
    const suppInsert = sqlite.prepare('INSERT INTO Supplier (accountId, name, contactPerson, phone, email, address, leadTimeDays, isActive, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const supplierIdMap = new Map();
    for (const supp of SUPPLIERS) {
      const result = suppInsert.run(accountId, supp.name, supp.contactPerson, supp.phone, supp.email, supp.address, supp.leadTimeDays, 1, supp.notes, now, now);
      supplierIdMap.set(supp.name, Number(result.lastInsertRowid));
    }
    console.log(`✅ ${SUPPLIERS.length} proveedores insertados.`);

    // ── Pedidos de Compra ───────────────────────────────────────────────────
    const adminUserId = sqlite.prepare('SELECT id FROM User WHERE username = ?').get('admin')?.id;
    if (!adminUserId) {
      console.warn('⚠️  No se encontró usuario admin para asociar pedidos.');
    } else {
      const poInsert = sqlite.prepare(`
        INSERT INTO PurchaseOrder (accountId, orderNumber, supplierId, status, subtotal, tax, freight, total, expectedDate, userId, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const poItemInsert = sqlite.prepare(`
        INSERT INTO PurchaseOrderItem (orderId, productId, quantityOrdered, quantityReceived, unitCost, total, received)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const order of PURCHASE_ORDERS) {
        const supplierId = supplierIdMap.get(order.supplier);
        if (!supplierId) {
          console.warn(`⚠️  Proveedor no encontrado para pedido ${order.orderNumber}: ${order.supplier}`);
          continue;
        }

        let subtotal = 0;
        const resolvedItems = [];
        for (const item of order.items) {
          const productId = productIdMap.get(item.productCode);
          if (!productId) {
            console.warn(`⚠️  Producto no encontrado: ${item.productCode}`);
            continue;
          }
          const product = PRODUCTS.find(p => p.code === item.productCode);
          const itemTotal = product.cost * item.quantity;
          subtotal += itemTotal;
          resolvedItems.push({ productId, quantity: item.quantity, unitCost: product.cost, total: itemTotal });
        }

        const result = poInsert.run(
          accountId, order.orderNumber, supplierId, order.status,
          subtotal, 0, 0, subtotal, now, adminUserId, now, now
        );
        const orderId = Number(result.lastInsertRowid);

        for (const item of resolvedItems) {
          poItemInsert.run(orderId, item.productId, item.quantity, 0, item.unitCost, item.total, 0);
        }
      }
      console.log(`✅ ${PURCHASE_ORDERS.length} pedidos de compra insertados.`);
    }

    sqlite.exec('COMMIT');
    console.log('\n🎉 ¡Datos mockup insertados con éxito!');

  } catch (err) {
    sqlite.exec('ROLLBACK');
    console.error('❌ Error insertando datos mockup:', err);
  } finally {
    sqlite.close();
  }
}

seedMockups().catch(console.error);
