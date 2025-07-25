const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// إعداد الخادم والواجهة
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
// قراءة البورت واسم البوت من المعاملات
const port = process.argv[2] || 3001;
const botName = process.argv[3] || 'DefaultBot';

console.log(`🤖 بدء تشغيل البوت: ${botName}`);
console.log(`📡 البورت المستخدم: ${port}`);
console.log(`📁 مجلد العمل: ${__dirname}`);

process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise مرفوض:', reason);
    process.exit(1);
});

// إعداد Express
app.use(express.static('public'));
app.use(express.json());

// متغيرات النظام
let sock = null;
let qrString = null;
let isConnected = false;
let pendingMessages = new Map();
let userStates = new Map();
let aiSessions = new Map();
x = "🤖 *المساعد الذكي جاهز لمساعدتك!*\n\nيمكنك سؤالي عن:\n"
y = "عذراً، أنا مختص في مجال الالكترونيات والأجهزة التقنية. يمكنك سؤالي عن:\n\n" + getAIBackMenu()
// حالات المستخدم
const USER_STATES = {
    INITIAL: 'initial',
    MAIN_MENU: 'main_menu',
    CONTACT_OWNER: 'contact_owner',
    VIEW_PRODUCTS: 'view_products',
    AI_CHAT: 'ai_chat',
    CATEGORY_VIEW: 'category_view'
};

// قراءة البيانات
async function loadData() {
    try {
        const productsData = await fs.readJson('./data/products.json');
        const settingsData = await fs.readJson('./data/settings.json');
        return { products: productsData, settings: settingsData };
    } catch (error) {
        console.error('خطأ في قراءة البيانات:', error);
        return null;
    }
}

// حفظ البيانات
async function saveData(type, data) {
    try {
        const filePath = `./data/${type}.json`;
        await fs.writeJson(filePath, data, { spaces: 2 });
        return true;
    } catch (error) {
        console.error('خطأ في حفظ البيانات:', error);
        return false;
    }
}

// إعداد Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// اختبار اتصال Gemini
async function testGeminiConnection() {
    try {
        const testResult = await model.generateContent('مرحبا');
        const response = await testResult.response;
        console.log('✅ اختبار Gemini نجح:', response.text().substring(0, 50));
        return true;
    } catch (error) {
        console.error('❌ اختبار Gemini فشل:', error);
        return false;
    }
}

// دالة للتفاعل مع Gemini - نسخة محسنة
async function askGeminiCustom(question, userId) {
    try {
        console.log(`🤖 سؤال AI من المستخدم ${userId}: ${question}`);
        
        const { settings, products } = await loadData();
        if (!settings || !products) {
            console.error('❌ لا يمكن قراءة البيانات');
            return 'عذراً، حدث خطأ في قراءة بيانات النظام.\n\n' + getAIBackMenu();
        }
        // الرد على أسئلة التوصيل مباشرة من وصف التوصيل
        const deliveryKeywords = ['لعندي على البيت', 'توصل','مواصلات', 'دلفري','توصيل', 'شحن'];
        if (deliveryKeywords.some(kw => question.toLowerCase().includes(kw))) {
            const delivery = settings.bot_config.delivery;
            if (delivery && delivery.enabled && delivery.description) {
                return delivery.description + "\n\n" + getAIBackMenu();
            } else {
                return 'حالياً لا نوفر خدمة التوصيل.' + "\n\n" + getAIBackMenu();
            }
        }
        // البحث في الأسئلة المخصصة أولاً
        const customQA = settings.bot_config?.ai?.ai_custom_qa || [];
        for (const qa of customQA) {
            if (qa.keywords && qa.keywords.some(kw => question.toLowerCase().includes(kw.toLowerCase()))) {
                return qa.answer + "\n\n" + getAIBackMenu();
            }
        }
        // تجهيز قائمة المنتجات للنموذج
        let productsText = '';
        if (products.products && products.products.length > 0) {
            productsText = '\n\nقائمة المنتجات المتوفرة:\n';
            products.products.forEach((p, idx) => {
                productsText += `\n${idx+1}. الاسم: ${p.name}\nالفئة: ${p.category}\nالسعر: ${p.price} ${p.currency}\nالوصف: ${p.description || ''}\nالمواصفات: ${(p.specifications||[]).join('، ')}\n`;
            });
            productsText += '\n*ملاحظة: أجب فقط من المنتجات التالية ولا تخترع منتجات غير موجودة*';
        } else {
            productsText = '\n\nلا توجد منتجات متوفرة حالياً.';
        }

        const storeInfo = settings.bot_config.ai_personality || '';
        // التحقق من حالة المستخدم
        if (userStates.get(userId) !== USER_STATES.AI_CHAT) {
            console.log(`❌ المستخدم ${userId} ليس في وضع AI`);
            return null;
        }
        // تخفيف قيود الكلمات المفتاحية
        const keywords = settings.bot_config.keywords || [];
        const storeRelatedWords = ['متجر', 'محل', 'شراء', 'سعر', 'منتج', 'جهاز', 'خدمة', 'ضمان', 'توصيل'];
        const allKeywords = [...keywords, ...storeRelatedWords];
        const hasKeyword = allKeywords.some(keyword => 
            question.toLowerCase().includes(keyword.toLowerCase())
        );
        // السماح بالأسئلة العامة عن المتجر
        const isGeneralStoreQuestion = question.length > 5;
        if (!hasKeyword && !isGeneralStoreQuestion) {
            return y;
        }
        // إنشاء جلسة AI
        if (!aiSessions.has(userId)) {
            aiSessions.set(userId, []);
        }
        const history = aiSessions.get(userId);
        const prompt = `${storeInfo}\n\n${productsText}$\n\nالتعليمات:\n- أجب فقط من المنتجات المذكورة أعلاه ولا تخترع منتجات غير موجودة.\n- اجب بطريقة ودودة ومهنية\n- قدم معلومات مفيدة ودقيقة\n- استخدم الرموز التعبيرية بشكل مناسب\n- إذا كان السؤال خارج مجال المنتجات، وجه العميل بلطف للمواضيع المناسبة\n- اذكر أنه يمكن التواصل مع صاحب المتجر للحصول على مساعدة أكثر تفصيلاً\n\nالسؤال: ${question}`;
        console.log('🔄 إرسال السؤال إلى Gemini...');
        const chatSession = model.startChat({
            history: history,
            generationConfig: {
                temperature: 0.7,
                topK: 64,
                topP: 0.95,
                maxOutputTokens: 1000,
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        });
        const result = await chatSession.sendMessage(prompt);
        const response = await result.response;
        const responseText = response.text();
        console.log('✅ تم الحصول على رد من Gemini');
        // حفظ في التاريخ
        history.push(
            { role: "user", parts: [{ text: question }] },
            { role: "model", parts: [{ text: responseText }] }
        );
        // الحد الأقصى للتاريخ
        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }
        // تحديث الجلسة
        aiSessions.set(userId, history);
        return responseText + "\n\n" + getAIBackMenu();
    } catch (error) {
        console.error('❌ خطأ في Gemini API:', error);
        // تحليل نوع الخطأ
        if (error.message && error.message.includes('API key')) {
            return '❌ مشكلة في مفتاح API. يرجى التواصل مع المطور.\n\n' + getAIBackMenu();
        } else if (error.message && error.message.includes('quota')) {
            return '❌ تم تجاوز الحد المسموح من الطلبات. حاول مرة أخرى لاحقاً.\n\n' + getAIBackMenu();
        } else if (error.message && error.message.includes('model')) {
            return '❌ مشكلة في نموذج الذكاء الاصطناعي. يرجى المحاولة لاحقاً.\n\n' + getAIBackMenu();
        } else {
            return '❌ عذراً، حدث خطأ مؤقت في الخدمة. يرجى المحاولة مرة أخرى.\n\n' + getAIBackMenu();
        }
    }
}

// دالة إنشاء القائمة الرئيسية
function createMainMenu() {
    return `🛍️ *مرحباً بك في متجر الالكترونيات الحديثة*

أهلاً وسهلاً بك في متجرنا! 
اختر الخدمة التي تريدها بكتابة الرقم المطلوب:

*1* - 📞 التحدث مع صاحب المتجر
*2* - 🛒 عرض المنتجات والفئات
*3* - 🤖 المساعد الذكي (تقنية Gemini AI)

*اكتب الرقم الذي تريده...*`;
}

// دالة قائمة المنتجات
async function createProductsTextMenu() {
    const { products } = await loadData();
    const categories = products.categories;
    
    let menuText = `🛒 *فئات المنتجات المتاحة:*

اختر الفئة التي تريد تصفحها بكتابة الرقم:

`;
    
    categories.forEach((category, index) => {
        menuText += `*${index + 1}* - ${category.icon} ${category.name}\n`;
    });
    
    menuText += `\n*0* - 🔙 العودة للقائمة الرئيسية\n\n*اكتب رقم الفئة المطلوبة...*`;
    
    return menuText;
}

// دالة عرض منتجات فئة معينة
async function createCategoryTextDisplay(categoryIndex) {
    const { products } = await loadData();
    const category = products.categories[categoryIndex];
    const categoryProducts = products.products.filter(p => p.category === category.id);
    
    let productText = `${category.icon} *${category.name}*\n\n`;
    
    if (categoryProducts.length === 0) {
        productText += "😔 لا توجد منتجات متاحة في هذه الفئة حالياً.\nتابعنا للحصول على أحدث المنتجات!";
    } else {
        categoryProducts.forEach((product, index) => {
            productText += `*${index + 1}. ${product.name}*\n`;
            productText += `💰 السعر: ${product.price} ${product.currency}\n`;
            productText += `📝 ${product.description}\n`;
            
            if (product.specifications && product.specifications.length > 0) {
                productText += `📋 المواصفات:\n`;
                product.specifications.forEach(spec => {
                    productText += `• ${spec}\n`;
                });
            }
            productText += '\n';
        });
    }
    
    productText += `─────────────────────
*1* - 📞 تواصل مع صاحب المتجر للشراء
*2* - 🛒 العودة لفئات المنتجات
*0* - 🏠 القائمة الرئيسية

*اكتب الرقم المطلوب...*`;
    
    return productText;
}

// دالة قائمة المساعد الذكي
function createAITextMenu() {
    return x;
}

// دالة قائمة العودة للمساعد الذكي
function getAIBackMenu() {
    return `─────────────────────
*0* - 🔙 العودة للقائمة الرئيسية
`;
}

// دالة رسالة خطأ الرقم
function getInvalidNumberMessage() {
    return `❌ *رقم غير صحيح*

الرجاء اختيار أحد الأرقام المتاحة فقط.

اكتب الرقم الصحيح من الخيارات الموجودة...`;
}

// دالة اتصال الواتساب
async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
        });
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrString = qr;
                io.emit('qr_code', qr);
                console.log('📱 QR Code جديد متوفر للواجهة');
            }
            
            if (connection === 'close') {
                isConnected = false;
                qrString = null;
                io.emit('connection_status', { connected: false });
                console.log('❌ تم قطع الاتصال');
                
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('🔄 محاولة إعادة الاتصال...');
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else {
                    console.log('🔐 تم تسجيل الخروج - إنشاء QR Code جديد...');
                    setTimeout(async () => {
                        try {
                            await fs.remove('./auth_info_baileys');
                            console.log('🗑️ تم حذف ملفات الجلسة');
                            setTimeout(() => connectToWhatsApp(), 2000);
                        } catch (error) {
                            console.error('خطأ في حذف ملفات الجلسة:', error);
                            setTimeout(() => connectToWhatsApp(), 5000);
                        }
                    }, 1000);
                }
            } else if (connection === 'open') {
                isConnected = true;
                qrString = null;
                io.emit('connection_status', { connected: true });
                console.log('✅ تم الاتصال بالواتساب بنجاح!');
                console.log('🤖 البوت جاهز مع نظام الأرقام');
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        // معالج الرسائل
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.key.fromMe && m.type === 'notify') {
                    const userId = msg.key.remoteJid;
                    // شرط: الرد فقط على الخاص (userId ينتهي بـ @s.whatsapp.net)
                    if (!userId.endsWith('@s.whatsapp.net')) {
                        // تجاهل أي رسالة ليست من دردشة خاصة
                        return;
                    }
                    const userName = msg.pushName || 'عميل';
                    
                    // معالجة الرسائل النصية فقط
                    if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
                        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                        
                        await handleTextMessage(userId, messageText.trim(), userName);
                    }
                }
            } catch (error) {
                console.error('❌ خطأ في معالجة الرسالة:', error);
            }
        });
        
    } catch (error) {
        console.error('❌ خطأ في الاتصال:', error);
        setTimeout(() => connectToWhatsApp(), 5000);
    }
}

// معالج الرسائل النصية المحسن
async function handleTextMessage(userId, messageText, userName) {
    try {
        const currentState = userStates.get(userId) || USER_STATES.INITIAL;
        const { settings } = await loadData();
        
        console.log(`📩 رسالة من ${userName}: ${messageText} | الحالة: ${currentState}`);
        
        // إذا كان المستخدم في وضع AI والرسالة ليست رقم تحكم
        if (currentState === USER_STATES.AI_CHAT && messageText !== '0' && messageText !== '1') {
            console.log('🤖 معالجة سؤال للذكاء الاصطناعي...');
            
            await sock.sendPresenceUpdate('composing', userId);
            
            try {
                const aiResponse = await askGeminiCustom(messageText, userId);
                
                if (aiResponse) {
                    // تقسيم الرد إذا كان طويلاً
                    if (aiResponse.length > 4000) {
                        const parts = aiResponse.match(/.{1,4000}/g);
                        for (let i = 0; i < parts.length; i++) {
                            await sock.sendMessage(userId, {
                                text: parts[i]
                            });
                            
                            if (i < parts.length - 1) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                    } else {
                        await sock.sendMessage(userId, {
                            text: aiResponse
                        });
                    }
                    
                    console.log('✅ تم إرسال رد الذكاء الاصطناعي');
                } else {
                    await sock.sendMessage(userId, {
                        text: '❌ عذراً، لا يمكنني الإجابة الآن. يرجى المحاولة لاحقاً.\n\n' + getAIBackMenu()
                    });
                }
            } catch (aiError) {
                console.error('❌ خطأ في معالجة AI:', aiError);
                await sock.sendMessage(userId, {
                    text: '❌ حدث خطأ في معالجة طلبك. يرجى المحاولة مرة أخرى.\n\n' + getAIBackMenu()
                });
            }
            
            await sock.sendPresenceUpdate('paused', userId);
            return;
        }
        
        // معالجة الأرقام حسب الحالة
        switch (currentState) {
            case USER_STATES.INITIAL:
            case USER_STATES.MAIN_MENU:
                await handleMainMenuChoice(userId, messageText, userName);
                break;
                
            case USER_STATES.VIEW_PRODUCTS:
                await handleProductsMenuChoice(userId, messageText, userName);
                break;
                
            case USER_STATES.CATEGORY_VIEW:
                await handleCategoryChoice(userId, messageText, userName);
                break;
                
            case USER_STATES.AI_CHAT:
                await handleAIMenuChoice(userId, messageText, userName);
                break;
                
            case USER_STATES.CONTACT_OWNER:
                userStates.set(userId, USER_STATES.MAIN_MENU);
                const mainMenu = createMainMenu();
                await sock.sendMessage(userId, { text: mainMenu });
                break;
                
            default:
                userStates.set(userId, USER_STATES.MAIN_MENU);
                const defaultMenu = createMainMenu();
                await sock.sendMessage(userId, { text: defaultMenu });
                break;
        }
        
    } catch (error) {
        console.error('❌ خطأ في معالجة الرسالة النصية:', error);
        
        userStates.set(userId, USER_STATES.MAIN_MENU);
        await sock.sendMessage(userId, {
            text: '❌ حدث خطأ أثناء معالجة طلبك.\n\n' + createMainMenu()
        });
    }
}

// معالج القائمة الرئيسية
async function handleMainMenuChoice(userId, choice, userName) {
    const { settings } = await loadData();
    
    switch (choice) {
        case '1':
            // التحدث مع صاحب المتجر
            userStates.set(userId, USER_STATES.CONTACT_OWNER);
            
            const messageId = uuidv4();
            pendingMessages.set(messageId, {
                userId: userId,
                userName: userName,
                timestamp: new Date().toISOString(),
                status: 'pending'
            });
            
            await sock.sendMessage(userId, {
                text: `📞 *تم إرسال طلبك لصاحب المتجر*

⏳ الرجاء الانتظار حتى الرد...
سيتم التواصل معك في أقرب وقت ممكن.

*شكراً لصبرك* 😊

اكتب أي شيء للعودة للقائمة الرئيسية`
            });
            
            // إشعار صاحب المتجر
            if (settings.admin.notifications && settings.admin.phone) {
                await sock.sendMessage(`${settings.admin.phone}@s.whatsapp.net`, {
                    text: `🔔 *طلب تواصل جديد من عميل*

👤 *الاسم:* ${userName}
📱 *الرقم:* ${userId}
🕐 *الوقت:* ${new Date().toLocaleString('ar-EG')}

*العميل ينتظر ردك...*

_رسالة تلقائية من بوت المتجر_`
                });
            }
            
            io.emit('new_pending_message', {
                id: messageId,
                userId: userId,
                userName: userName,
                timestamp: new Date().toISOString()
            });
            break;
            
        case '2':
            // عرض المنتجات
            userStates.set(userId, USER_STATES.VIEW_PRODUCTS);
            const productsMenu = await createProductsTextMenu();
            await sock.sendMessage(userId, { text: productsMenu });
            break;
            
        case '3':
            // المساعد الذكي
            userStates.set(userId, USER_STATES.AI_CHAT);
            aiSessions.delete(userId);
            const aiMenu = createAITextMenu();
            await sock.sendMessage(userId, { text: aiMenu });
            break;
            
        default:
            // أي شيء آخر، إرسال القائمة الرئيسية
            userStates.set(userId, USER_STATES.MAIN_MENU);
            const welcomeMenu = createMainMenu();
            await sock.sendMessage(userId, { text: welcomeMenu });
            break;
    }
}

// معالج قائمة المنتجات
async function handleProductsMenuChoice(userId, choice, userName) {
    const { products } = await loadData();
    
    if (choice === '0') {
        userStates.set(userId, USER_STATES.MAIN_MENU);
        const mainMenu = createMainMenu();
        await sock.sendMessage(userId, { text: mainMenu });
        return;
    }
    
    const categoryIndex = parseInt(choice) - 1;
    
    if (categoryIndex >= 0 && categoryIndex < products.categories.length) {
        userStates.set(userId, USER_STATES.CATEGORY_VIEW);
        userStates.set(`${userId}_category`, categoryIndex);
        
        const categoryDisplay = await createCategoryTextDisplay(categoryIndex);
        await sock.sendMessage(userId, { text: categoryDisplay });
    } else {
        const invalidMsg = getInvalidNumberMessage() + '\n\n' + await createProductsTextMenu();
        await sock.sendMessage(userId, { text: invalidMsg });
    }
}

// معالج اختيار الفئة
async function handleCategoryChoice(userId, choice, userName) {
    const { settings } = await loadData();
    
    switch (choice) {
        case '0':
            userStates.set(userId, USER_STATES.MAIN_MENU);
            userStates.delete(`${userId}_category`);
            const mainMenu = createMainMenu();
            await sock.sendMessage(userId, { text: mainMenu });
            break;
            
        case '1':
            userStates.set(userId, USER_STATES.CONTACT_OWNER);
            userStates.delete(`${userId}_category`);
            
            const messageId = uuidv4();
            pendingMessages.set(messageId, {
                userId: userId,
                userName: userName,
                timestamp: new Date().toISOString(),
                status: 'pending'
            });
            
            await sock.sendMessage(userId, {
                text: `📞 *تم إرسال طلبك لصاحب المتجر*

⏳ الرجاء الانتظار حتى الرد...
سيتم التواصل معك في أقرب وقت ممكن.

*شكراً لصبرك* 😊

اكتب أي شيء للعودة للقائمة الرئيسية`
            });
            
            if (settings.admin.notifications && settings.admin.phone) {
                await sock.sendMessage(`${settings.admin.phone}@s.whatsapp.net`, {
                    text: `🔔 *طلب تواصل جديد من عميل*

👤 *الاسم:* ${userName}
📱 *الرقم:* ${userId}
🕐 *الوقت:* ${new Date().toLocaleString('ar-EG')}

*العميل مهتم بالمنتجات وينتظر ردك...*

_رسالة تلقائية من بوت المتجر_`
                });
            }
            break;
            
        case '2':
            userStates.set(userId, USER_STATES.VIEW_PRODUCTS);
            userStates.delete(`${userId}_category`);
            const productsMenu = await createProductsTextMenu();
            await sock.sendMessage(userId, { text: productsMenu });
            break;
            
        default:
            const categoryIndex = userStates.get(`${userId}_category`) || 0;
            const invalidMsg = getInvalidNumberMessage() + '\n\n' + await createCategoryTextDisplay(categoryIndex);
            await sock.sendMessage(userId, { text: invalidMsg });
            break;
    }
}

// معالج قائمة المساعد الذكي
async function handleAIMenuChoice(userId, choice, userName) {
    switch (choice) {
        case '0':
            userStates.set(userId, USER_STATES.MAIN_MENU);
            aiSessions.delete(userId);
            const mainMenu = createMainMenu();
            await sock.sendMessage(userId, { text: mainMenu });
            break;
        case '1':
            const aiMenu = createAITextMenu();
            await sock.sendMessage(userId, { text: aiMenu });
            break;
        case '2':
            aiSessions.delete(userId);
            await sock.sendMessage(userId, { text: '✅ تم بدء محادثة جديدة مع المساعد الذكي. يمكنك الآن طرح سؤالك من جديد.' });
            break;
        default:
            // أي شيء آخر يعتبر سؤال للذكاء الاصطناعي
            break;
    }
}

// APIs للواجهة
app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        hasQR: qrString !== null,
        activeUsers: userStates.size,
        pendingMessages: pendingMessages.size
    });
});

app.get('/api/qr', async (req, res) => {
    if (qrString) {
        try {
            const qrImage = await qrcode.toDataURL(qrString);
            res.json({ qr: qrImage });
        } catch (error) {
            res.status(500).json({ error: 'خطأ في توليد QR Code' });
        }
    } else {
        res.status(404).json({ error: 'QR Code غير متوفر' });
    }
});

app.post('/api/reset-qr', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
        }
        
        await fs.remove('./auth_info_baileys');
        
        setTimeout(() => {
            connectToWhatsApp();
        }, 2000);
        
        res.json({ success: true, message: 'تم إعادة تعيين الجلسة' });
    } catch (error) {
        res.status(500).json({ error: 'خطأ في إعادة تعيين الجلسة' });
    }
});

app.get('/api/data/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const data = await fs.readJson(`./data/${type}.json`);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'خطأ في قراءة البيانات' });
    }
});

app.post('/api/data/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const success = await saveData(type, req.body);
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ error: 'خطأ في حفظ البيانات' });
        }
    } catch (error) {
        res.status(500).json({ error: 'خطأ في حفظ البيانات' });
    }
});

app.get('/api/pending-messages', (req, res) => {
    const messages = Array.from(pendingMessages.entries()).map(([id, data]) => ({
        id,
        ...data
    }));
    res.json(messages);
});

app.delete('/api/pending-messages/:id', (req, res) => {
    const { id } = req.params;
    const deleted = pendingMessages.delete(id);
    res.json({ success: deleted });
});

app.get('/api/stats', (req, res) => {
    res.json({
        connected: isConnected,
        activeUsers: userStates.size,
        pendingMessages: pendingMessages.size,
        aiSessions: aiSessions.size,
        uptime: process.uptime()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO للتحديثات المباشرة
io.on('connection', (socket) => {
    console.log('🌐 واجهة إدارة متصلة');
    
    socket.emit('connection_status', { connected: isConnected });
    
    if (qrString) {
        socket.emit('qr_code', qrString);
    }
    
    socket.emit('stats_update', {
        activeUsers: userStates.size,
        pendingMessages: pendingMessages.size,
        aiSessions: aiSessions.size
    });
});

// إنشاء المجلدات المطلوبة
async function createDirectories() {
    await fs.ensureDir('./data');
    await fs.ensureDir('./public');
    await fs.ensureDir('./public/css');
    await fs.ensureDir('./public/js');
}

// تنظيف البيانات المؤقتة
setInterval(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    for (const [userId, session] of aiSessions.entries()) {
        if (now - session.lastActivity > oneHour) {
            aiSessions.delete(userId);
        }
    }
    
    for (const [userId, state] of userStates.entries()) {
        if (now - (state.lastActivity || 0) > oneHour) {
            userStates.delete(userId);
            userStates.delete(`${userId}_category`);
        }
    }
    
    console.log('🧹 تم تنظيف البيانات المؤقتة');
}, 60 * 60 * 1000);

// بدء التشغيل
async function startBot() {
    try {
        await createDirectories();
        
        // إنشاء ملفات البيانات الافتراضية
        if (!await fs.pathExists('./data/products.json')) {
            const defaultProducts = {
                "store_info": {
                    "name": "متجر الالكترونيات الحديثة",
                    "description": "أفضل الأجهزة الإلكترونية بأسعار منافسة",
                    "phone": "96171392367",
                    "location": "بيروت، لبنان",
                    "working_hours": "9:00 ص - 10:00 م",
                },
                "categories": [
                    {
                        "id": "smartphones",
                        "name": "الهواتف الذكية",
                        "icon": "📱"
                    },
                    {
                        "id": "laptops",
                        "name": "أجهزة الكمبيوتر",
                        "icon": "💻"
                    },
                    {
                        "id": "accessories",
                        "name": "الإكسسوارات",
                        "icon": "🔌"
                    }
                ],
                "products": [
                    {
                        "id": "1",
                        "name": "iPhone 15 Pro",
                        "category": "smartphones",
                        "price": 1200,
                        "currency": "USD",
                        "description": "أحدث هاتف من آبل مع شريحة A17 Pro",
                        "image": "iphone15pro.jpg",
                        "specifications": [
                            "شاشة 6.1 بوصة Super Retina XDR",
                            "كاميرا 48 ميجابكسل",
                            "ذاكرة 128/256/512/1TB",
                            "مقاوم للماء IP68"
                        ]
                    },
                    {
                        "id": "2",
                        "name": "MacBook Air M3",
                        "category": "laptops",
                        "price": 1100,
                        "currency": "USD",
                        "description": "أحدث جهاز MacBook Air مع شريحة M3",
                        "image": "macbook_air_m3.jpg",
                        "specifications": [
                            "شريحة Apple M3",
                            "ذاكرة 8GB/16GB",
                            "تخزين 256GB/512GB SSD",
                            "شاشة 13.6 بوصة Liquid Retina"
                        ]
                    }
                ]
            };
            await saveData('products', defaultProducts);
        }
        
        if (!await fs.pathExists('./data/settings.json')) {
            const defaultSettings = {
                "bot_config": {
                    "store_mode": true,
                    "ai_personality": "أنا مساعد ذكي لمتجر الالكترونيات الحديثة. أساعد العملاء في العثور على أفضل الأجهزة الإلكترونية وأقدم المشورة المهنية حول المنتجات. أجيب على الأسئلة بطريقة ودودة ومفيدة.",
                    "restricted_topics": [
                        "السياسة",
                        "الدين",
                        "المحتوى غير اللائق"
                    ],
                    "keywords": [
                        "هاتف",
                        "جهاز",
                        "كمبيوتر",
                        "لابتوب",
                        "سعر",
                        "شراء",
                        "توصيل",
                        "ضمان",
                        "مواصفات",
                        "متجر",
                        "محل",
                        "منتج",
                        "خدمة",
                        "عرض",
                        "تقسيط",
                        "صيانة"
                    ],
                    "auto_responses": {
                        "greeting": "مرحباً بك في متجر الالكترونيات الحديثة! 🛍️",
                        "goodbye": "شكراً لك! نتطلع لخدمتك مرة أخرى 😊",
                        "contact_owner": "الرجاء الانتظار حتى الرد ⏳"
                    },
                    "ai": {
                        "ai_custom_qa": [
                            {
                                "keywords": ["مواصفات", "هاتف", "جهاز", "موبايل"],
                                "answer": "يمكنني مساعدتك في تقديم معلومات مفصلة عن مواصفات الهواتف والأجهزة الذكية. يمكنك سؤالي عن أي منتج محدد، وسأقدم لك المعلومات التفصيلية."
                            },
                            {
                                "keywords": ["سعر", "أسعار", "عرض", "تقسيط"],
                                "answer": "يمكنني مساعدتك في تقديم أسعار المنتجات والعروض الحالية. يمكنك سؤالي عن أي منتج للحصول على أفضل الأسعار والعروض."
                            },
                            {
                                "keywords": ["ضمان", "صيانة", "خدمة", "توصيل"],
                                "answer": "يمكنني مساعدتك في تقديم معلومات عن ضمان المنتجات وخدمات الصيانة وتفضيلات التوصيل."
                            }
                        ]
                    },
                    "delivery": {
                        "enabled": true,
                        "description": "نقوم بتوصيل المنتجات في جميع أنحاء لبنان. يمكنك التواصل معنا للحصول على مزيد من المعلومات أو الطلب."
                    }
                },
                "admin": {
                    "phone": "96171392367",
                    "notifications": true,
                    "auto_reply_delay": 2000
                }
            };
            await saveData('settings', defaultSettings);
        }
        
        // اختبار Gemini قبل البدء
        console.log('🔍 اختبار اتصال Gemini AI...');
        await testGeminiConnection();
        
        server.listen(port, () => {
            console.log(`🌐 لوحة التحكم متاحة على: http://localhost:${port}`);
        });
        
        console.log('🚀 بدء تشغيل البوت مع نظام الأرقام المحسن...');
        connectToWhatsApp();
        
    } catch (error) {
        console.error('خطأ في بدء التشغيل:', error);
    }
}

// معالجة إيقاف التشغيل
process.on('SIGINT', async () => {
    console.log('\n🛑 إيقاف البوت...');
    
    if (sock) {
        await sock.logout();
    }
    
    server.close(() => {
        console.log('✅ تم إيقاف البوت بنجاح');
        process.exit(0);
    });
});

startBot();
