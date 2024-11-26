const Order = require('../model/order.model'); // Assuming the Order model is in the 'models' directory
const MenuItem = require('../model/item.model');
const Company = require('../model/company.model'); // Replace with your actual model path

const Feedback = require('../model/feedback.model');
const User = require('../model/user.model');
const ExcelJS = require('exceljs');  // Assuming MenuItem model is in the 'models' directory

// Add new order
const nodemailer = require('nodemailer');

exports.createOrder = async (req, res) => {
  try {
    const { userId, items, paymentMethod, deliveryDate } = req.body;

    // Validate that all required fields are provided
    if (!userId || !items || !paymentMethod || !deliveryDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Calculate the total price and enrich items with item names
    let totalPrice = 0;
    const enrichedItems = [];
    for (const item of items) {
      const menuItem = await MenuItem.findById(item.itemId); // Fetch item details by itemId
      if (!menuItem) {
        return res.status(404).json({ message: `Menu item with ID ${item.itemId} not found.` });
      }

      // Add item name and other details to the enrichedItems array
      enrichedItems.push({
        itemId: menuItem._id,
        itemName: menuItem.itemName,
        quantity: item.quantity,
        extras: item.extras || [],
      });

      // Multiply the item price by quantity and add it to totalPrice
      totalPrice += menuItem.price * item.quantity;
    }

    // Create a new order object based on the provided data
    const newOrder = new Order({
      userId,
      items: enrichedItems.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity,
        extras: item.extras,
      })),
      totalPrice,
      paymentMethod,
      paymentStatus: 'completed', // Default payment status
      deliveryDate,
      status: 'ordered', // Default status
    });

    // Save the order to the database
    await newOrder.save();

    // Fetch user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Send an order confirmation email to the user
    const transporter = nodemailer.createTransport({
      service: 'gmail', // Use Gmail's SMTP server
      auth: {
        user: process.env.EMAIL_USERNAME, // Your email address
        pass: process.env.EMAIL_PASSWORD, // Your email password or app password
      },
    });

    const emailSubject = 'Order Confirmation';
    const emailText = `
      Hello ${user.fullName},

      Thank you for your order! Here are your order details:

      Order ID: ${newOrder._id}
      Total Price: $${totalPrice}
      Delivery Date: ${new Date(deliveryDate).toLocaleDateString()}

      Items Ordered:
      ${enrichedItems
        .map((item, index) => {
          return `${index + 1}. ${item.quantity} x ${item.itemName}`;
        })
        .join('\n')}

      We hope you enjoy your meal!

      Best regards,
      Your Company Team
    `;

    // Send the email
    await transporter.sendMail({
      from: process.env.EMAIL_USERNAME, // Sender address
      to: user.email,                   // Recipient email
      subject: emailSubject,            // Email subject
      text: emailText,                  // Email content
    });

    console.log(`Order confirmation email sent to ${user.email}`);

    // Return a success response with the created order and enriched items
    res.status(201).json({
      message: 'Order created successfully and email sent',
      order: {
        ...newOrder.toObject(),
        items: enrichedItems, // Include enriched items with item names
      },
      totalPrice,
    });
  } catch (err) {
    console.error('Error creating order:', err);
    res.status(500).json({ message: 'An error occurred while creating the order.' });
  }
};


exports.orderList = async (req, res) => {
  try {
    // Retrieve all orders and populate user, company, and item details
    const orders = await Order.find()
      .populate({
        path: 'userId',
        select: 'name fullName email phoneNumber companyId',
        populate: {
          path: 'companyId',
          select: 'name address contactNumber'
        }
      })
      .populate({
        path: 'items.itemId',
        select: 'itemName price' // Select itemName and price fields
      });

    if (orders.length === 0) {
      return res.status(404).json({ message: 'No orders found.' });
    }

    // Format the response data
    const formattedOrders = orders.map(order => {
      // Check if userId is not null or undefined
      if (!order.userId) {
        return null; // Skip this order if userId is missing
      }

      // Format order details
      return {
        orderId: order._id,
        userId: {
          _id: order.userId._id,
          name: order.userId.name,
          fullName: order.userId.fullName, // Include fullName
          email: order.userId.email,
          phoneNumber: order.userId.phoneNumber, // Include phoneNumber
          companyId: order.userId.companyId ? {
            _id: order.userId.companyId._id,
            name: order.userId.companyId.name,
            address: order.userId.companyId.address,
            contactNumber: order.userId.companyId.contactNumber
          } : null // Check if companyId exists
        },
        items: order.items.map(item => ({
          itemId: item.itemId ? item.itemId._id : null, // Check if itemId exists
          name: item.itemId ? item.itemId.itemName : null, // Include itemName
          price: item.itemId ? item.itemId.price : null, // Include item price
          quantity: item.quantity,
          extras: item.extras
        })),
        totalPrice: order.totalPrice,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        deliveryDate: order.deliveryDate, // Changed from deliveryTime to deliveryDate
        status: order.status,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      };
    }).filter(order => order !== null); // Remove null orders where userId is missing

    // Send response with orders in the requested format
    res.status(200).json({
      message: 'Orders fetched successfully',
      orders: formattedOrders
    });
  } catch (err) {
    console.error('Error fetching order list:', err);
    res.status(500).json({ message: 'An error occurred while fetching the order list.' });
  }
};


  
  exports.orderInsight = async (req, res) => {
    try {
      // Fetch data for the current day
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay()); // Set to the start of the current week (Sunday)
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7); // End of the week (Saturday)
  
      // Calculate revenue for each day of the current week
      const dailyRevenue = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startOfWeek, $lt: endOfWeek }, // Match orders within this week
          },
        },
        {
          $group: {
            _id: { $dayOfWeek: '$createdAt' }, // Group by day of the week (1 = Sunday, 7 = Saturday)
            totalRevenue: { $sum: '$totalPrice' }, // Calculate total revenue per day
          },
        },
        {
          $sort: { '_id': 1 }, // Sort by day of the week
        },
      ]);
  
      // Format the daily revenue data
      const formattedDailyRevenue = Array.from({ length: 7 }, (_, i) => ({
        day: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i],
        totalRevenue: 0,
      }));
  
      // Populate formattedDailyRevenue with data from the query
      dailyRevenue.forEach(({ _id, totalRevenue }) => {
        formattedDailyRevenue[_id - 1].totalRevenue = totalRevenue; // _id corresponds to the day of the week (1 = Sunday)
      });
  
      // Other data for the overview
      const ordersToday = await Order.countDocuments({
        createdAt: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) }, // Today's orders
      });
  
      const ordersThisWeek = await Order.countDocuments({
        createdAt: { $gte: startOfWeek, $lt: endOfWeek }, // Orders for this week
      });
  
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const ordersThisMonth = await Order.countDocuments({
        createdAt: { $gte: startOfMonth, $lt: endOfMonth },
      });
  
      const totalRevenue = await Order.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: '$totalPrice' }, // Total revenue across all orders
          },
        },
      ]);
  
      const totalCompanies = await Company.countDocuments();
      const totalEmployees = await Employee.countDocuments();
  
      const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate({
          path: 'userId',
          select: 'fullName email phoneNumber companyId',
          populate: {
            path: 'companyId',
            select: 'name',
          },
        });
  
      const feedbackStats = await Feedback.aggregate([
        {
          $group: {
            _id: null,
            averageRating: { $avg: '$rating' },
            totalReviews: { $sum: 1 },
          },
        },
      ]);
  
      const formattedRecentOrders = recentOrders.map(order => ({
        employeeName: order.userId?.fullName || 'N/A',
        emailAddress: order.userId?.email || 'N/A',
        phoneNumber: order.userId?.phoneNumber || 'N/A',
        companyName: order.userId?.companyId?.name || 'N/A',
        createdAt: order.createdAt,
      }));
  
      res.status(200).json({
        numberOfOrdersToday: ordersToday,
        numberOfOrdersThisWeek: ordersThisWeek,
        numberOfOrdersThisMonth: ordersThisMonth,
        totalRevenue: totalRevenue[0]?.total || 0,
        totalCompanies,
        totalEmployees,
        recentOrders: formattedRecentOrders,
        averageReview: feedbackStats[0]?.averageRating || 0,
        reviewCount: feedbackStats[0]?.totalReviews || 0,
        weeklyRevenueBreakdown: formattedDailyRevenue, // Revenue breakdown for each day of the current week
      });
    } catch (error) {
      console.error('Error fetching order insights:', error);
      res.status(500).json({ message: 'An error occurred while fetching order insights.' });
    }
  };
  exports.myOrder = async (req, res) => {
    const { userId } = req.query; // Assuming userId is passed as a URL parameter
  
    try {
      // Fetch orders for the given userId
      const orders = await Order.find({ userId }).populate('items'); // Adjust 'items' if you need to populate related data
  
      if (!orders || orders.length === 0) {
        return res.status(404).json({ message: 'No orders found for this user.' });
      }
  
      res.status(200).json({
        message: 'Orders fetched successfully.',
        orders,
      });
    } catch (error) {
      console.error('Error fetching orders:', error);
      res.status(500).json({ message: 'An error occurred while fetching orders.' });
    }
  };

  exports.getAllCompaniesWithOrderCount = async (req, res) => {
    try {
      // Fetch all companies
      const companies = await Company.find();

      if (!companies || companies.length === 0) {
        return res.status(404).json({ message: 'No companies found' });
      }
  
      // Step 2: Create a result array
      const result = [];
  
      // Step 3: Loop through each company
      for (const company of companies) {
        // Find users associated with the current company
        const users = await User.find({ companyId: company._id });
  
        if (!users || users.length === 0) {
          result.push({
            companyName: company.name,
            orderCount: 0,
            orders: [],
          });
          continue;
        }
  
        // Extract user IDs for the company
        const userIds = users.map(user => user._id);
  
        // Find orders for these user IDs
        const orders = await Order.find({ userId: { $in: userIds } });
  
        // Add the company's orders to the result
        result.push({
          companyName: company.name,
          orderCount: orders.length,
          orders,
        });
      }
  
      // Step 4: Return the grouped orders
      res.json(result);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Internal server error' });
    }
  };
 

 // Ensure this is installed: npm install exceljs

 exports.getOrdersByCompanyIdAndDate = async (req, res) => {
  try {
      const { companyId, deliveryDate } = req.query;

      if (!companyId) {
          return res.status(400).json({ message: 'Company ID is required' });
      }

      if (!deliveryDate) {
          return res.status(400).json({ message: 'Delivery date is required' });
      }

      // Parse the delivery date
      const date = new Date(deliveryDate);
      if (isNaN(date.getTime())) {
          return res.status(400).json({ message: 'Invalid delivery date format' });
      }

      // Define start and end of the day for filtering
      const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
      const endOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59));

      // Find the company by ID
      const company = await Company.findById(companyId);
      if (!company) {
          return res.status(404).json({ message: `No company found with ID ${companyId}` });
      }

      // Fetch users associated with the company
      const users = await User.find({ companyId });
      if (!users.length) {
          return res.status(404).json({ message: `No users found for company with ID ${companyId}` });
      }

      // Extract user IDs
      const userIds = users.map(user => user._id);

      // Fetch orders for these users and the specified delivery date
      const orders = await Order.find({
          userId: { $in: userIds },
          deliveryDate: { $gte: startOfDay, $lt: endOfDay },
      }).populate('items.itemId');
      if (!orders.length) {
          return res.status(404).json({ message: `No orders found for company with ID ${companyId} on ${deliveryDate}` });
      }

      // Create an Excel workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Orders Summary');

      // Add headers to the Excel sheet
      worksheet.columns = [
          { header: 'Order ID', key: 'orderId', width: 25 },
          { header: 'User ID', key: 'userId', width: 25 },
          { header: 'Delivery Date', key: 'deliveryDate', width: 20 },
          { header: 'Status', key: 'status', width: 15 },
          { header: 'Item Name', key: 'itemName', width: 25 },
          { header: 'Quantity', key: 'quantity', width: 10 },
          { header: 'Extras', key: 'extras', width: 30 },
          { header: 'Total Price', key: 'totalPrice', width: 15 },
      ];

      // Populate rows with order data
      for (const order of orders) {
          for (const item of order.items) {
              worksheet.addRow({
                  orderId: order._id.toString(),
                  userId: order.userId.toString(),
                  deliveryDate: order.deliveryDate.toISOString().split('T')[0],
                  status: order.status,
                  itemName: item.itemId?.itemName || 'Unknown', // Use optional chaining to avoid errors
                  quantity: item.quantity,
                  extras: item.extras.join(', '), // Join extras array into a comma-separated string
                  totalPrice: order.totalPrice,
              });
          }
      }

      // Add styling (optional)
      worksheet.getRow(1).font = { bold: true }; // Bold headers

      // Set response headers for Excel file
      res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
          'Content-Disposition',
          `attachment; filename=orders_summary_${company.name.replace(/\s+/g, '_')}_${deliveryDate}.xlsx`
      );

      // Write the workbook to the response
      await workbook.xlsx.write(res);
      res.end();
  } catch (error) {
      console.error('Error exporting orders:', error);
      res.status(500).json({ message: 'Error exporting orders', error: error.message });
  }
};
 


  exports.getOrderCountByDeliveryDate = async (req, res) => {
    try {
        const { deliveryDate } = req.query;

        // Validate the query parameter
        if (!deliveryDate) {
            return res.status(400).json({ message: 'Delivery date is required.' });
        }

        // Parse the deliveryDate
        const date = new Date(deliveryDate);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ message: 'Invalid delivery date format.' });
        }

        // Set start and end of the day in UTC
        const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0));
        const endOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59));

        // Fetch orders within the specified deliveryDate range and populate `userId`
        const orders = await Order.find({
            deliveryDate: {
                $gte: startOfDay,
                $lt: endOfDay,
            },
        }).populate('userId', 'companyId'); // Populate userId to access companyId

        if (!orders.length) {
            return res.status(404).json({ message: 'No orders found for the specified delivery date.' });
        }

        // Collect all unique companyIds from orders
        const companyIds = new Set();
        orders.forEach(order => {
            if (order.userId?.companyId) {
                companyIds.add(order.userId.companyId.toString());
            }
        });

        // Fetch company details for the collected companyIds
        const companies = await Company.find({ _id: { $in: Array.from(companyIds) } });

        // Group and count orders by `companyId`
        const orderCounts = orders.reduce((acc, order) => {
            const companyId = order.userId?.companyId?.toString() || 'Unknown';

            if (!acc[companyId]) {
                const company = companies.find(c => c._id.toString() === companyId);
                acc[companyId] = {
                    companyId: company ? company._id : null,
                    companyName: company ? company.name : 'Unknown',
                    orderCount: 0,
                };
            }

            acc[companyId].orderCount += 1;
            return acc;
        }, {});

        // Convert the result to an array
        const response = Object.values(orderCounts);

        // Return the response
        res.status(200).json({
            message: 'Order counts retrieved successfully.',
            deliveryDate: deliveryDate.split('T')[0], // Return the date without time
            counts: response,
        });
    } catch (error) {
        console.error('Error fetching order counts:', error.message);
        res.status(500).json({ message: 'Error fetching order counts.', error: error.message });
    }
};


  







