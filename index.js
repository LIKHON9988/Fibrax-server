require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const stripe = require("stripe")(process.env.STRIPE_SECERET_KEY);

const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const db = client.db("productsDb");
    const productColl = db.collection("products");
    const ordersColl = db.collection("orders");

    // post product data

    app.post("/products", async (req, res) => {
      const productData = req.body;
      const result = await productColl.insertOne(productData);
      res.send(result);
    });

    // get products

    app.get("/products", async (req, res) => {
      const cursor = productColl.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/products/:id", async (req, res) => {
      const id = req.params.id;
      const cursor = productColl.findOne({ _id: new ObjectId(id) });
      const result = await cursor;
      res.send(result);
    });

    // payment parts---------->
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      console.log(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo?.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.cutomer?.email,
        mode: "payment",
        metadata: {
          productId: String(paymentInfo?.productId),
          customer_name: paymentInfo.customer.customer,
          customer_email: paymentInfo.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/paymentSuccessful?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/product/${paymentInfo?.productId}`,
      });
      res.send({ url: session.url });
    });

    // ------------

    app.post("/paymentSuccessful", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(session);

      const product = await productColl.findOne({
        _id: new ObjectId(session.metadata.productId),
      });

      const order = await ordersColl.findOne({
        transactionId: session.payment_intent,
      });

      if (session.status === "complete" && product && !order) {
        const orderInfo = {
          productId: session.metadata.productId,
          transactionId: session.payment_intent,
          customer_email: session.metadata.customer_email,
          customer_name: session.metadata.customer_name,
          status: "pending",
          manager: product.maneger,
          name: product.name,
          category: product.category,
          quantity: 1,
          price: session.amount_total / 100,
        };
        const result = await ordersColl.insertOne(orderInfo);

        await productColl.updateOne(
          { _id: new ObjectId(session.metadata.productId) },
          { $inc: { quantity: -1 } }
        );

        return res.send(
          { transactionId: session.payment_intent },
          { orderId: result.insertedId }
        );
      }
      res.send(
        { transactionId: session.payment_intent },
        { orderId: order._id }
      );
    });

    // get my orders for customers by email------------>

    app.get("/my-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await ordersColl
        .find({
          customer_email: email,
        })
        .toArray();

      res.send(result);
    });

    // get  orders for manager by email------------>

    app.get("/manage-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await ordersColl
        .find({
          "manager.email": email,
        })
        .toArray();

      res.send(result);
    });

    // get manage_ products for manager by email------------>

    app.get("/manage-products/:email", async (req, res) => {
      const email = req.params.email;
      const result = await productColl
        .find({
          "maneger.email": email,
        })
        .toArray();

      res.send(result);
    });

    //  get all orders

    app.get("/all-orders", async (req, res) => {
      const cursor = ordersColl.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    // delete order by id
    app.delete("/orders/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await ordersColl.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 1) {
          res.send({ success: true, message: "Order deleted" });
        } else {
          res.status(404).send({ success: false, message: "Order not found" });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: "Delete failed" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
