
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const bcrypt = require("bcrypt");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./lotto.db", (err) => {
  if (err) console.error("Failed to open DB:", err.message);
  else console.log("Connected to SQLite database.");
});

// ------------------- Utils -------------------
async function hashPassword(password) {
  const saltRounds = 10;
  return await bcrypt.hash(password, saltRounds);
}

// ------------------- Seed Admin -------------------
async function seedAdmin() {
  const adminEmail = "admin@example.com";
  const adminPassword = "admin123";

  db.get("SELECT * FROM customer WHERE email = ?", [adminEmail], async (err, row) => {
    if (err) return console.error(err);
    if (!row) {
      const hashedPassword = await hashPassword(adminPassword);
      db.run(
        "INSERT INTO customer (fullname, phone, email, password, wallet_balance, role) VALUES (?, ?, ?, ?, ?, ?)",
        ["Administrator", "0000000000", adminEmail, hashedPassword, 1000, "admin"]
      );
      console.log(`Admin account created: ${adminEmail} / ${adminPassword}`);
    } else {
      console.log("Admin account already exists");
    }
  });
}

// ------------------- Create Tables -------------------
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS customer (
      cus_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullname TEXT,
      phone TEXT,
      email TEXT UNIQUE,
      password TEXT,
      wallet_balance REAL DEFAULT 0,
      role TEXT DEFAULT 'user'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lotto (
      lotto_id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT,
      round INTEGER,
      price REAL DEFAULT 80,
      status TEXT DEFAULT 'available'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS purchase (
      purchase_id INTEGER PRIMARY KEY AUTOINCREMENT,
      cus_id INTEGER,
      lotto_id INTEGER,
      round INTEGER,
      purchase_date TEXT DEFAULT CURRENT_TIMESTAMP,
      is_redeemed INTEGER DEFAULT 0,
      FOREIGN KEY (cus_id) REFERENCES customer(cus_id),
      FOREIGN KEY (lotto_id) REFERENCES lotto(lotto_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prize (
      prize_id INTEGER PRIMARY KEY AUTOINCREMENT,
      round INTEGER,
      prize_type TEXT,
      number TEXT,
      reward_amount REAL
    )
  `, (err) => {
    if (!err) seedAdmin();
  });
});

// ------------------- Helper: Generate Lotto -------------------
function generateLotto(round, amount = 100) {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      db.run("DELETE FROM lotto WHERE round = ?", [round], async (err) => {
        if (err) return reject(err);

        const generated = new Set();
        const stmt = db.prepare("INSERT INTO lotto (number, round, price, status) VALUES (?, ?, ?, ?)");

        while (generated.size < amount) {
          const num = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
          if (!generated.has(num)) {
            generated.add(num);
            await new Promise((res, rej) =>
              stmt.run(num, round, 80, "available", (err) => err ? rej(err) : res())
            );
          }
        }

        stmt.finalize((err) => {
          if (err) return reject(err);
          resolve(Array.from(generated));
        });
      });
    });
  });
}

// ------------------- Draw Prizes Helper -------------------
function drawPrizes(round) {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) AS cnt FROM prize WHERE round = ?", [round], (err, row) => {
      if (err) return reject(err);
      if (row.cnt > 0) return reject("รางวัลงวดนี้ถูกสุ่มแล้ว");

      db.all("SELECT number FROM lotto WHERE round = ?", [round], (err, rows) => {
        if (err) return reject(err);
        if (!rows || rows.length === 0) return reject("ยังไม่มีเลข Lotto งวดนี้");

        // shuffle numbers
        const shuffled = rows.map(r => r.number).sort(() => 0.5 - Math.random());

        const firstPrizeFull = shuffled[0]; // เลขเต็มรางวัลที่ 1
        const secondPrizeFull = shuffled[1] || null;
        const thirdPrizeFull = shuffled[2] || null;
        const last3 = firstPrizeFull.slice(-3); // เลขท้าย 3 ตัวจากรางวัลที่ 1
        const last2Random = String(Math.floor(Math.random() * 100)).padStart(2, "0"); // เลขท้าย 2 ตัวสุ่มใหม่

        const prizes = [
          { prize_type: "รางวัลที่ 1", number: firstPrizeFull, reward_amount: 6000000 },
          { prize_type: "รางวัลที่ 2", number: secondPrizeFull, reward_amount: 200000 },
          { prize_type: "รางวัลที่ 3", number: thirdPrizeFull, reward_amount: 80000 },
          { prize_type: "เลขท้าย 3 ตัว", number: last3, reward_amount: 4000 },
          { prize_type: "เลขท้าย 2 ตัว", number: last2Random, reward_amount: 2000 },
        ];

        const stmt = db.prepare(
          "INSERT INTO prize (round, prize_type, number, reward_amount) VALUES (?, ?, ?, ?)"
        );

        // run inserts and wait for completion
        const insertPromises = prizes.map(p => {
          return new Promise((res, rej) => {
            stmt.run(round, p.prize_type, p.number, p.reward_amount, (err) => {
              if (err) return rej(err);
              res();
            });
          });
        });

        Promise.all(insertPromises)
          .then(() => {
            stmt.finalize((err) => {
              if (err) return reject(err);
              resolve(prizes);
            });
          })
          .catch((e) => reject(e));
      });
    });
  });
}

// ------------------- API -------------------

// Register
app.post("/register", async (req, res) => {
  const { fullname, phone, email, password, wallet_balance } = req.body;
  if (!fullname || !phone || !email || !password)
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });

  try {
    const hashedPassword = await hashPassword(password);
    const role = "user";
    const balance = wallet_balance || 0;
    db.run(
      `INSERT INTO customer (fullname, phone, email, password, wallet_balance, role)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fullname, phone, email, hashedPassword, balance, role],
      function (err) {
        if (err) return res.status(400).json({ error: err.message });
        res.status(201).json({
          message: "สมัครสมาชิกสำเร็จ",
          cus_id: this.lastID,
          fullname,
          phone,
          email,
          wallet_balance: balance,
          role,
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "กรุณากรอก email และ password" });

  db.get("SELECT * FROM customer WHERE email = ?", [email], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ message: "ไม่พบบัญชีผู้ใช้นี้" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });

    const customer = {
      cus_id: user.cus_id,
      fullname: user.fullname,
      phone: user.phone,
      email: user.email,
      wallet_balance: user.wallet_balance,
      role: user.role,
    };

    res.json({
      message: "เข้าสู่ระบบสำเร็จ",
      customer,
    });
  });
});

// Current round (next)
app.get("/current-round", (req, res) => {
  db.get("SELECT MAX(round) as maxRound FROM lotto", [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const nextRound = (row?.maxRound || 0) + 1;
    res.json({ round: nextRound });
  });
});

// Generate lotto
app.post("/generate", async (req, res) => {
  try {
    const row = await new Promise((resolve, reject) =>
      db.get("SELECT MAX(round) as maxRound FROM lotto", (err, r) => err ? reject(err) : resolve(r))
    );

    const round = (row?.maxRound || 0) + 1;

    if (round > 1) {
      const prevRound = round - 1;
      const r = await new Promise((resolve, reject) =>
        db.get("SELECT COUNT(*) as cnt FROM prize WHERE round = ?", [prevRound], (err, r) =>
          err ? reject(err) : resolve(r)
        )
      );

      if (r.cnt === 0)
        return res.status(400).json({ message: "ยังไม่ออกรางวัลงวดก่อน" });
    }

    const lottoNumbers = await generateLotto(round, 100);
    res.json({ message: `สร้าง Lotto งวด ${round} สำเร็จ 🎉`, lottoNumbers, round });

  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "เกิดข้อผิดพลาดขณะสร้าง Lotto", error: e.toString() });
  }
});
// สมมติใช้ Express และ DB เป็น MySQL / PostgreSQL

app.post("/draw-from-sold/:round", (req, res) => {
  const round = req.params.round;

  // 1. เช็คว่ารางวัลรอบนี้ถูกสุ่มแล้วหรือยัง
  db.all("SELECT * FROM prize WHERE round = ?", [round], (err, existingPrizes) => {
    if (err) return res.status(500).json({ message: "เกิดข้อผิดพลาดบน server" });

    if (existingPrizes.length > 0) {
      return res.status(400).json({ message: "รางวัลงวดนี้ถูกสุ่มแล้ว", prizes: existingPrizes });
    }

    // 2. ดึงเลขที่ขายแล้ว
    db.all(
      "SELECT number FROM lotto WHERE round = ? AND status = 'sold'",
      [round],
      (err, rows) => {
        if (err) return res.status(500).json({ message: "เกิดข้อผิดพลาดบน server" });

        if (!rows || rows.length === 0) {
          return res.status(400).json({ message: "ยังไม่มีเลขขาย" });
        }

        // 3. สุ่มเลข
        const shuffled = rows.map(r => r.number).sort(() => 0.5 - Math.random());
        const firstPrize = shuffled[0];
        const secondPrize = shuffled[1] || "-";
        const thirdPrize = shuffled[2] || "-";

        const prizes = [
          { prize_type: "รางวัลที่ 1", number: firstPrize, reward_amount: 6000000 },
          { prize_type: "รางวัลที่ 2", number: secondPrize, reward_amount: 200000 },
          { prize_type: "รางวัลที่ 3", number: thirdPrize, reward_amount: 80000 },
          { prize_type: "เลขท้าย 3 ตัว", number: firstPrize.slice(-3), reward_amount: 4000 },
          { prize_type: "เลขท้าย 2 ตัว", number: secondPrize !== "-" ? secondPrize.slice(-2) : "-", reward_amount: 2000 },
        ];

        // 4. บันทึกลง DB
        const stmt = db.prepare(
          "INSERT INTO prize (round, prize_type, number, reward_amount) VALUES (?, ?, ?, ?)"
        );

        for (const p of prizes) {
          stmt.run(round, p.prize_type, p.number, p.reward_amount);
        }

        stmt.finalize((err) => {
          if (err) return res.status(500).json({ message: "บันทึกรางวัลล้มเหลว" });
          res.json({ message: "สุ่มรางวัลจากเลขขายแล้วเรียบร้อย 🎉", prizes });
        });
      }
    );
  });
});

app.get("/my-lotto/:cus_id", (req, res) => {
  const cusId = req.params.cus_id;

  db.all(
    `SELECT p.purchase_id, l.lotto_id, l.number, p.round, p.purchase_date, p.is_redeemed
     FROM purchase p
     JOIN lotto l ON p.lotto_id = l.lotto_id
     WHERE p.cus_id = ?
     ORDER BY p.purchase_date DESC`,
    [cusId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ myLotto: rows });
    }
  );
});




// Sold numbers
app.get("/sold-lotto/:round", (req, res) => {
  const round = req.params.round;
  db.all(
    "SELECT number FROM lotto WHERE round = ? AND status = 'sold'",
    [round],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const sold_numbers = rows.map(r => r.number);
      res.json({ message: "ดึงเลขที่ขายแล้ว", soldNumbers: sold_numbers });
    }
  );
});

// Prize info
app.get("/prize/:round", (req, res) => {
  const round = req.params.round;
  db.all("SELECT * FROM prize WHERE round = ?", [round], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (rows.length === 0) return res.json({ message: "ยังไม่ได้สุ่มรางวัล", prizes: [] });
    res.json({ message: "รางวัลงวดนี้", prizes: rows });
  });
});

// Draw prizes
app.post("/draw-prizes/:round", async (req, res) => {
  const round = req.params.round;
  try {
    const prizes = await drawPrizes(round);
    res.json({ message: "สุ่มรางวัลสำเร็จ", prizes });
  } catch (e) {
    res.status(400).json({ message: e.toString() });
  }
});

// Redeem
app.post("/redeem/:purchase_id", (req, res) => {
  const purchaseId = req.params.purchase_id;

  db.get(
    "SELECT is_redeemed, lotto_id, round FROM purchase WHERE purchase_id = ?",
    [purchaseId],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ message: "ไม่พบการซื้อ" });
      if (row.is_redeemed) return res.status(400).json({ message: "คุณขึ้นเงินรางวัลแล้ว" });

      // get lotto number
      db.get("SELECT number FROM lotto WHERE lotto_id = ?", [row.lotto_id], (err, lottoRow) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!lottoRow) return res.status(404).json({ message: "ไม่พบเลขล็อตโต้" });

        const lottoNumber = lottoRow.number;

        // fetch all prizes for the round and match appropriately
        db.all("SELECT * FROM prize WHERE round = ?", [row.round], (err, prizeRows) => {
          if (err) return res.status(500).json({ error: err.message });

          let matchedPrize = null;
          for (const p of prizeRows) {
            if (!p.prize_type) continue;
            if (p.prize_type === "เลขท้าย 3 ตัว") {
              if (lottoNumber.slice(-3) === p.number) {
                matchedPrize = p;
                break;
              }
            } else if (p.prize_type === "เลขท้าย 2 ตัว") {
              if (lottoNumber.slice(-2) === p.number) {
                matchedPrize = p;
                break;
              }
            } else {
              // full number match for main prizes
              if (lottoNumber === p.number) {
                matchedPrize = p;
                break;
              }
            }
          }

          if (!matchedPrize) return res.status(400).json({ message: "เลขนี้ไม่ถูกรางวัล" });

          db.run(
            //----------------------------แก้ไขเพิ่ม----------------------------------//
            "UPDATE customer SET wallet_balance = wallet_balance + ? WHERE cus_id = (SELECT cus_id FROM purchase WHERE purchase_id = ?)",
            [matchedPrize.reward_amount, purchaseId],
            //-----------------------------แก้ไขเพิ่ม---------------------------------//
            (err) => {
              if (err) return res.status(500).json({ error: err.message });
              res.json({
                message: "ขึ้นเงินรางวัลสำเร็จ",
                prize: matchedPrize,
              });
            }
          );
        });
      });
    }
  );
});

// Reset system
app.post("/reset-system", (req, res) => {
  db.serialize(() => {
    db.run("DELETE FROM lotto");
    db.run("DELETE FROM purchase");
    db.run("DELETE FROM prize");
    db.run("DELETE FROM customer WHERE role!='admin'", (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.run("DELETE FROM sqlite_sequence WHERE name='lotto'");
      db.run("DELETE FROM sqlite_sequence WHERE name='purchase'");
      db.run("DELETE FROM sqlite_sequence WHERE name='prize'");
      db.run("DELETE FROM sqlite_sequence WHERE name='customer' AND seq>0");

      res.json({ message: "รีเซ็ตระบบเรียบร้อยแล้ว ยกเว้น admin" });
    });
  });
});

// Buy Lotto (แก้ไข: ตรวจยอด, หักยอด, อัปเดตสถานะ)
app.post("/buy", (req, res) => {
  const { cus_id, lotto_id, round } = req.body;

  if (!cus_id || !lotto_id || !round)
    return res.status(400).json({ error: "กรุณาระบุ cus_id, lotto_id, round" });

  // first: get lotto to know price
  db.get("SELECT * FROM lotto WHERE lotto_id = ? AND round = ?", [lotto_id, round], (err, lotto) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!lotto) return res.status(404).json({ message: "ไม่พบเลขนี้" });
    if (lotto.status !== "available")
      return res.status(400).json({ message: "เลขนี้ถูกซื้อไปแล้ว" });

    const price = lotto.price || 80;

    // then check customer balance
    db.get("SELECT * FROM customer WHERE cus_id = ?", [cus_id], (err, customer) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!customer) return res.status(404).json({ message: "ไม่พบลูกค้า" });

      if (Number(customer.wallet_balance) < Number(price)) {
        return res.status(400).json({ message: "ยอดเงินไม่เพียงพอ" });
      }

      // proceed: update lotto status -> insert purchase -> deduct wallet -> respond
      db.run("UPDATE lotto SET status = 'sold' WHERE lotto_id = ?", [lotto_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.run(
          `INSERT INTO purchase (cus_id, lotto_id, round) VALUES (?, ?, ?)`,
          [cus_id, lotto_id, round],
          function (err) {
            if (err) return res.status(500).json({ error: err.message });

            // deduct wallet
            db.run(
              "UPDATE customer SET wallet_balance = wallet_balance - ? WHERE cus_id = ?",
              [price, cus_id],
              (err) => {
                if (err) return res.status(500).json({ error: err.message });

                // get updated balance
                db.get("SELECT wallet_balance FROM customer WHERE cus_id = ?", [cus_id], (err, row) => {
                  if (err) return res.status(500).json({ error: err.message });

                  res.json({
                    message: "ซื้อสำเร็จ",
                    purchase_id: this.lastID,
                    lotto: {
                      lotto_id,
                      number: lotto.number,
                      round,
                    },
                    wallet_balance: row ? row.wallet_balance : null,
                  });
                });
              }
            );
          }
        );
      });
    });
  });
});

// Get available lotto numbers of a round
app.get("/lotto/:round", (req, res) => {
  const round = req.params.round;
  db.all(
    "SELECT * FROM lotto WHERE round = ? AND status = 'available'",
    [round],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ lotto: rows });
    }
  );
});

app.get("/last-round", (req, res) => {
  db.get("SELECT MAX(round) as maxRound FROM lotto", [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ round: row?.maxRound || 0 });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
