const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// معالجة الأخطاء العامة
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
    console.log('🔄 محاولة الاستمرار...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise مرفوض:', reason);
});

// Middleware أساسي
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Middleware لتسجيل الطلبات
app.use((req, res, next) => {
    console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// اختبار اتصال بسيط
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'السيرفر يعمل بنجاح',
        timestamp: new Date().toISOString(),
        port: PORT 
    });
});

// مسارات ثابتة
const BOTS_DIR = path.join(__dirname, 'bots');
const TEMPLATE_DIR = path.join(__dirname, 'bots_template');
const DATA_FILE = path.join(__dirname, 'bots-data.json');

let activeBots = [];
let nextPort = 3001;

// تحميل البيانات المحفوظة
function loadBotsData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            activeBots = JSON.parse(data) || [];
            if (activeBots.length) {
                nextPort = Math.max(...activeBots.map(b => b.port)) + 1;
            }
            console.log(`✅ تم تحميل ${activeBots.length} بوت من القرص`);
        } else {
            console.log('📝 ملف البيانات غير موجود - سيتم إنشاؤه عند الحاجة');
        }
    } catch (err) {
        console.error('❌ خطأ في قراءة البيانات:', err);
        activeBots = [];
    }
}

// حفظ البيانات
function saveBotsData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(activeBots, null, 2), 'utf8');
        console.log('💾 تم حفظ البيانات');
    } catch (err) {
        console.error('❌ فشل في حفظ البيانات:', err);
    }
}

// إنشاء المجلدات
async function ensureDirectories() {
    try {
        await fs.ensureDir(BOTS_DIR);
        await fs.ensureDir(TEMPLATE_DIR);
        console.log('✅ المجلدات جاهزة');
    } catch (error) {
        console.error('❌ خطأ في إنشاء المجلدات:', error);
    }
}

// الحصول على بورت متاح
function getNextAvailablePort() {
    while (activeBots.some(b => b.port === nextPort)) {
        nextPort++;
    }
    return nextPort++;
}

// فحص حالة البوت
function checkBotStatus(botName) {
    return new Promise((resolve) => {
        exec('pm2 jlist', { timeout: 5000 }, (error, stdout, stderr) => {
            if (error) {
                console.log(`⚠️ تعذر فحص حالة ${botName}: ${error.message}`);
                resolve('unknown');
                return;
            }
            
            try {
                const processes = JSON.parse(stdout);
                const bot = processes.find(p => p.name === botName);
                if (bot) {
                    const status = bot.pm2_env.status === 'online' ? 'online' : 'stopped';
                    resolve(status);
                } else {
                    resolve('not_found');
                }
            } catch (e) {
                console.log(`⚠️ خطأ في تحليل بيانات pm2: ${e.message}`);
                resolve('unknown');
            }
        });
    });
}

// === ROUTES ===

// إنشاء بوت جديد
app.post('/create-bot', async (req, res) => {
    try {
        const { botName } = req.body;
        
        if (!botName || !botName.trim()) {
            return res.status(400).json({ error: 'اسم البوت مطلوب' });
        }

        const sanitized = botName.trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!sanitized) {
            return res.status(400).json({ error: 'اسم البوت غير صالح' });
        }

        const botPath = path.join(BOTS_DIR, sanitized);

        // فحص القالب
        if (!await fs.pathExists(TEMPLATE_DIR)) {
            return res.status(400).json({ error: 'مجلد bots_template غير موجود' });
        }

        // فحص التكرار
        if (await fs.pathExists(botPath)) {
            return res.status(400).json({ error: 'يوجد بوت بهذا الاسم' });
        }

        // نسخ القالب
        await fs.copy(TEMPLATE_DIR, botPath);
        console.log(`✅ نسخ البوت: ${botPath}`);

        // تثبيت المكتبات
        console.log('🔄 تثبيت المكتبات...');
        await new Promise((resolve, reject) => {
            exec('npm install', { 
                cwd: botPath, 
                timeout: 60000
            }, (error, stdout, stderr) => {
                if (error) {
                    console.error('❌ خطأ npm install:', error);
                    reject(error);
                } else {
                    console.log('✅ تم تثبيت المكتبات');
                    resolve();
                }
            });
        });

        // الحصول على بورت
        const port = getNextAvailablePort();

        // تشغيل PM2
        const pm2Cmd = `pm2 start "${path.join(botPath, 'index.js')}" --name "${sanitized}" --cwd "${botPath}" -- ${port} ${sanitized}`;
        
        exec(pm2Cmd, { timeout: 10000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('❌ خطأ PM2:', error);
                return res.status(500).json({ 
                    error: 'فشل في تشغيل البوت', 
                    details: error.message 
                });
            }

            const newBot = {
                name: sanitized,
                port: port,
                url: `http://localhost:${port}`,
                status: 'online',
                createdAt: new Date().toISOString()
            };

            activeBots.push(newBot);
            saveBotsData();

            console.log(`✅ البوت ${sanitized} يعمل على ${port}`);
            res.json({
                success: true,
                bot: newBot,
                message: `تم إنشاء ${sanitized} بنجاح`
            });
        });

    } catch (error) {
        console.error('❌ خطأ في إنشاء البوت:', error);
        res.status(500).json({ 
            error: 'خطأ داخلي', 
            details: error.message 
        });
    }
});

// قائمة البوتات
app.get('/bots', async (req, res) => {
    try {
        // تحديث حالة كل بوت
        for (let bot of activeBots) {
            bot.status = await checkBotStatus(bot.name);
        }
        saveBotsData();
        res.json(activeBots);
    } catch (error) {
        console.error('❌ خطأ في جلب البوتات:', error);
        res.status(500).json({ error: 'فشل في جلب البوتات' });
    }
});

// Toggle البوت
app.post('/toggle-bot/:botName', async (req, res) => {
    const { botName } = req.params;
    
    try {
        console.log(`🔄 Toggle البوت: ${botName}`);
        
        const currentStatus = await checkBotStatus(botName);
        const action = currentStatus === 'online' ? 'stop' : 'start';
        
        console.log(`📊 ${botName}: ${currentStatus} -> ${action}`);
        
        exec(`pm2 ${action} "${botName}"`, { timeout: 10000 }, async (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ فشل ${action}:`, error);
                return res.status(500).json({ 
                    error: `فشل في ${action === 'start' ? 'تشغيل' : 'إيقاف'} البوت`,
                    details: error.message 
                });
            }

            setTimeout(async () => {
                const newStatus = await checkBotStatus(botName);
                
                const bot = activeBots.find(b => b.name === botName);
                if (bot) {
                    bot.status = newStatus;
                    saveBotsData();
                }

                console.log(`✅ ${botName} حالة جديدة: ${newStatus}`);
                
                res.json({ 
                    success: true, 
                    status: newStatus,
                    message: `تم ${action === 'start' ? 'تشغيل' : 'إيقاف'} ${botName}`
                });
            }, 2000);
        });
        
    } catch (error) {
        console.error('❌ خطأ Toggle:', error);
        res.status(500).json({ 
            error: 'خطأ في تبديل الحالة', 
            details: error.message 
        });
    }
});

// إعادة تشغيل البوت
app.post('/restart-bot/:botName', async (req, res) => {
    const { botName } = req.params;
    
    try {
        console.log(`🔄 إعادة تشغيل: ${botName}`);
        
        exec(`pm2 restart "${botName}"`, { timeout: 15000 }, async (error) => {
            if (error) {
                console.error('❌ فشل إعادة التشغيل:', error);
                return res.status(500).json({ 
                    error: 'فشل في إعادة التشغيل', 
                    details: error.message 
                });
            }

            setTimeout(async () => {
                const bot = activeBots.find(b => b.name === botName);
                if (bot) {
                    bot.status = await checkBotStatus(botName);
                    saveBotsData();
                }
                
                res.json({ 
                    success: true, 
                    message: `تم إعادة تشغيل ${botName}`
                });
            }, 3000);
        });
        
    } catch (error) {
        console.error('❌ خطأ إعادة التشغيل:', error);
        res.status(500).json({ 
            error: 'خطأ داخلي', 
            details: error.message 
        });
    }
});

// حذف بوت
app.delete('/delete-bot/:botName', async (req, res) => {
    const { botName } = req.params;

    try {
        console.log(`🗑️ حذف البوت: ${botName}`);
        
        exec(`pm2 delete "${botName}"`, { timeout: 10000 }, async (error) => {
            activeBots = activeBots.filter(b => b.name !== botName);
            saveBotsData();

            const botDir = path.join(BOTS_DIR, botName);
            if (await fs.pathExists(botDir)) {
                await fs.remove(botDir);
                console.log(`🗑️ تم حذف مجلد ${botName}`);
            }

            res.json({ 
                success: true, 
                message: `تم حذف ${botName} نهائياً` 
            });
        });
    } catch (error) {
        console.error('❌ خطأ في الحذف:', error);
        res.status(500).json({ 
            error: 'فشل في حذف البوت', 
            details: error.message 
        });
    }
});

// معالج للمسارات غير الموجودة
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'المسار غير موجود',
        path: req.originalUrl 
    });
});

// تشغيل السيرفر
async function startServer() {
    try {
        await ensureDirectories();
        loadBotsData();
        
        const server = app.listen(PORT, () => {
            console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
            console.log(`🧪 اختبر: http://localhost:${PORT}/health`);
            console.log(`📊 تم تحميل ${activeBots.length} بوت`);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`❌ البورت ${PORT} مستخدم!`);
                console.log('💡 الحلول:');
                console.log('1. pm2 stop all');
                console.log('2. PORT=3001 npm start');
                process.exit(1);
            } else {
                console.error('❌ خطأ السيرفر:', err);
            }
        });

    } catch (error) {
        console.error('❌ فشل في بدء السيرفر:', error);
        process.exit(1);
    }
}

startServer();
