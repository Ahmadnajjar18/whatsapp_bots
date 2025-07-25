// متغيرات عامة
let activeBots = [];
let searchTimeout = null;
let updateInterval = null;

// تحميل البوتات عند تحميل الصفحة
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 تحميل لوحة التحكم...');
    
    // إعداد النظام
    setupSearch();
    setupFilters();
    loadBots();
    
    // تحديث دوري كل 30 ثانية
    updateInterval = setInterval(loadBots, 30000);
    
    console.log('✅ تم تحميل النظام بنجاح');
});

// إعداد نظام البحث
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    
    if (searchInput) {
        // إزالة المستمعات السابقة لتجنب التكرار
        searchInput.removeEventListener('input', handleSearch);
        searchInput.removeEventListener('keydown', handleSearchKeydown);
        
        // إضافة المستمعات الجديدة
        searchInput.addEventListener('input', handleSearch);
        searchInput.addEventListener('keydown', handleSearchKeydown);
        console.log('✅ تم إعداد نظام البحث');
    } else {
        console.error('❌ عنصر البحث غير موجود');
    }
}

// إعداد نظام التصفية
function setupFilters() {
    const statusFilter = document.getElementById('statusFilter');
    
    if (statusFilter) {
        statusFilter.removeEventListener('change', applyFilters);
        statusFilter.addEventListener('change', applyFilters);
        console.log('✅ تم إعداد نظام التصفية');
    } else {
        console.log('⚠️ عنصر التصفية غير موجود - سيتم تجاهله');
    }
}

// دالة إنشاء بوت جديد
async function createNewBot() {
    const botName = prompt('أدخل اسم البوت الجديد:');
    
    if (!botName || !botName.trim()) {
        showToast('يجب إدخال اسم صحيح للبوت', 'warning');
        return;
    }

    // التحقق من الأحرف المسموحة
    const sanitized = botName.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized) {
        showToast('اسم البوت يجب أن يحتوي على أحرف وأرقام فقط', 'error');
        return;
    }

    // التحقق من التكرار
    if (activeBots.some(bot => bot.name.toLowerCase() === sanitized.toLowerCase())) {
        showToast('يوجد بوت بهذا الاسم مسبقاً', 'warning');
        return;
    }

    showLoading(true, 'جاري إنشاء البوت...', 0);

    try {
        console.log('📤 إرسال طلب إنشاء بوت:', sanitized);
        
        // محاكاة التقدم
        simulateProgress();
        
        const response = await fetch('/create-bot', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ botName: sanitized })
        });

        console.log('📥 استلام رد السيرفر:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('📊 نتيجة الإنشاء:', result);

        if (result.success) {
            showToast(`✅ ${result.message}`, 'success');
            setTimeout(() => {
                loadBots();
            }, 2000);
        } else {
            console.error('❌ خطأ في الإنشاء:', result);
            showToast(`❌ ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في الشبكة:', error);
        showToast(`❌ خطأ في الاتصال: ${error.message}`, 'error');
    }

    showLoading(false);
}

// محاكاة شريط التقدم
function simulateProgress() {
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) {
            progress = 90;
            clearInterval(progressInterval);
        }
        updateProgress(progress);
    }, 500);
}

// تحديث شريط التقدم
function updateProgress(percentage) {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
    }
}

// دالة تحميل البوتات
async function loadBots() {
    try {
        console.log('🔄 تحميل البوتات...');
        
        const response = await fetch('/bots');
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }
        
        activeBots = await response.json();
        console.log(`📊 تم تحميل ${activeBots.length} بوت`);
        
        updateStats();
        applyFilters(); // استخدام applyFilters بدلاً من renderBots مباشرة
        
    } catch (error) {
        console.error('❌ خطأ في تحميل البوتات:', error);
        showToast('❌ فشل في تحميل البوتات', 'error');
    }
}

// تحديث الإحصائيات
function updateStats() {
    const totalElement = document.getElementById('totalBots');
    const onlineElement = document.getElementById('onlineBots');
    const offlineElement = document.getElementById('offlineBots');
    
    if (totalElement && onlineElement && offlineElement) {
        const totalBots = activeBots.length;
        const onlineBots = activeBots.filter(bot => bot.status === 'online').length;
        const offlineBots = totalBots - onlineBots;

        totalElement.textContent = totalBots;
        onlineElement.textContent = onlineBots;
        offlineElement.textContent = offlineBots;
    }
}

// دالة معالجة البحث
function handleSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    
    if (!searchInput) return;
    
    const query = searchInput.value.trim();
    console.log('🔍 البحث عن:', query);
    
    // إظهار/إخفاء زر المسح
    if (clearBtn) {
        clearBtn.style.display = query ? 'flex' : 'none';
    }
    
    // تأخير البحث لتحسين الأداء
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
    
    searchTimeout = setTimeout(() => {
        applyFilters();
    }, 300);
}

// دالة معالجة الضغط على مفاتيح في البحث
function handleSearchKeydown(event) {
    if (event.key === 'Escape') {
        clearSearch();
    }
    
    if (event.key === 'Enter') {
        event.preventDefault();
        applyFilters();
    }
}

// دالة مسح البحث
function clearSearch() {
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    const resultsElement = document.getElementById('searchResults');
    
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }
    
    if (resultsElement) {
        resultsElement.style.display = 'none';
    }
    
    applyFilters();
    console.log('🧹 تم مسح البحث');
}

// ✨ تطبيق المرشحات والبحث - مُحدث ومُصحح
function applyFilters() {
    console.log('🎯 تطبيق المرشحات والبحث...');
    
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const resultsElement = document.getElementById('searchResults');
    const resultsCount = document.getElementById('resultsCount');
    const filterInfo = document.getElementById('filterInfo');
    
    // الحصول على قيم البحث والتصفية
    const searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const statusQuery = statusFilter ? statusFilter.value : 'all';
    
    console.log(`🔍 البحث: "${searchQuery}" | التصفية: "${statusQuery}"`);
    
    // تصفية البوتات
    let filteredBots = activeBots.filter(bot => {
        // فحص مطابقة الاسم
        const nameMatch = searchQuery === '' || bot.name.toLowerCase().includes(searchQuery);
        
        // فحص مطابقة الحالة
        const statusMatch = statusQuery === 'all' || bot.status === statusQuery;
        
        const isMatch = nameMatch && statusMatch;
        
        // تسجيل تفصيلي للتشخيص
        if (searchQuery && !nameMatch) {
            console.log(`❌ البوت ${bot.name} لا يطابق البحث "${searchQuery}"`);
        }
        if (statusQuery !== 'all' && !statusMatch) {
            console.log(`❌ البوت ${bot.name} لا يطابق التصفية "${statusQuery}" (حالته: ${bot.status})`);
        }
        if (isMatch) {
            console.log(`✅ البوت ${bot.name} يطابق المعايير`);
        }
        
        return isMatch;
    });
    
    console.log(`📊 تم العثور على ${filteredBots.length} نتيجة من أصل ${activeBots.length}`);
    
    // تحديث عداد النتائج
    if (resultsElement && resultsCount) {
        if (searchQuery || statusQuery !== 'all') {
            resultsCount.textContent = filteredBots.length;
            
            let filterText = '';
            if (statusQuery !== 'all') {
                const statusNames = {
                    'online': 'نشط',
                    'stopped': 'متوقف',
                    'unknown': 'غير معروف'
                };
                filterText = ` (${statusNames[statusQuery]})`;
            }
            
            if (filterInfo) {
                filterInfo.textContent = filterText;
            }
            
            resultsElement.style.display = 'block';
        } else {
            resultsElement.style.display = 'none';
        }
    }
    
    // عرض النتائج
    renderBots(filteredBots, searchQuery);
}

// ✨ عرض البوتات - مُحدث ومُصحح
function renderBots(botsToRender = null, searchQuery = '') {
    console.log('🎨 عرض البوتات...');
    
    const container = document.getElementById('botsContainer');
    const emptyState = document.getElementById('emptyState');
    
    if (!container || !emptyState) {
        console.error('❌ عناصر HTML مفقودة - container:', !!container, 'emptyState:', !!emptyState);
        return;
    }

    const bots = botsToRender || activeBots;
    console.log(`📋 عرض ${bots.length} بوت`);
    
    // عرض رسالة فارغة إذا لم توجد نتائج
    if (bots.length === 0) {
        container.innerHTML = '';
        
        const hasActiveFilters = searchQuery || (document.getElementById('statusFilter')?.value !== 'all');
        
        if (hasActiveFilters) {
            // رسالة عدم وجود نتائج بحث
            emptyState.innerHTML = `
                <div class="no-results">
                    <div class="empty-icon">🔍</div>
                    <h3>لا توجد نتائج ${searchQuery ? `للبحث "${searchQuery}"` : 'للمرشح المحدد'}</h3>
                    <p>جرب كلمات مختلفة أو غير المرشح</p>
                    <button onclick="clearAllFilters()" class="btn btn-primary" style="margin-top: 15px;">
                        🧹 مسح جميع المرشحات
                    </button>
                </div>
            `;
        } else {
            // رسالة افتراضية
            emptyState.innerHTML = `
                <div class="empty-icon">📱</div>
                <h3>لا توجد بوتات حالياً</h3>
                <p>اضغط على زر "إضافة بوت جديد" لإنشاء أول بوت لك</p>
                <button onclick="createNewBot()" class="btn btn-primary" style="margin-top: 20px;">
                    ➕ إنشاء بوت الآن
                </button>
            `;
        }
        
        emptyState.style.display = 'block';
        console.log('📭 عرض رسالة فارغة');
        return;
    }
    
    // إخفاء رسالة الفراغ
    emptyState.style.display = 'none';
    
    // عرض البوتات
    console.log('🎨 إنشاء HTML للبوتات...');
    const botsHTML = bots.map(bot => {
        const isOnline = bot.status === 'online';
        const statusText = getStatusText(bot.status);
        const statusClass = getStatusClass(bot.status);
        
        // تمييز النص المطابق في البحث
        const highlightedName = highlightSearchTerm(bot.name, searchQuery);
        
        return `
            <div class="bot-card search-highlight" data-bot="${bot.name}" data-status="${bot.status}">
                <div class="bot-header">
                    <div class="bot-name">🤖 ${highlightedName}</div>
                    <div class="bot-status-container">
                        <div class="bot-status ${statusClass}">${statusText}</div>
                        <div class="toggle-switch ${isOnline ? 'active' : ''}" 
                             onclick="toggleBot('${bot.name}')"
                             title="تشغيل/إيقاف البوت">
                            <div class="toggle-slider"></div>
                            <span class="toggle-text off">OFF</span>
                            <span class="toggle-text on">ON</span>
                        </div>
                    </div>
                </div>
                
                <div class="bot-info">
                    <div class="bot-port">📡 البورت: ${bot.port}</div>
                    <div class="bot-created">📅 تم الإنشاء: ${formatDate(bot.createdAt)}</div>
                    <div class="bot-status-detail">🔍 الحالة: ${bot.status}</div>
                </div>
                
                <div class="bot-actions">
                    <a href="${bot.url}" target="_blank" class="btn btn-primary" title="فتح البوت">
                        🔗 فتح البوت
                    </a>
                    <button onclick="restartBot('${bot.name}')" class="btn btn-restart" title="إعادة تشغيل">
                        🔄 إعادة تشغيل
                    </button>
                    <button onclick="deleteBot('${bot.name}')" class="btn btn-danger" title="حذف نهائي">
                        🗑️ حذف
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = botsHTML;
    console.log(`✅ تم عرض ${bots.length} بوت بنجاح`);
}

// مسح جميع المرشحات
function clearAllFilters() {
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    
    if (searchInput) {
        searchInput.value = '';
    }
    if (statusFilter) {
        statusFilter.value = 'all';
    }
    
    clearSearch();
    console.log('🧹 تم مسح جميع المرشحات');
}

// دالة مساعدة لنص الحالة
function getStatusText(status) {
    const statusMap = {
        'online': 'نشط',
        'stopped': 'متوقف',
        'not_found': 'غير موجود',
        'unknown': 'غير معروف'
    };
    return statusMap[status] || 'غير محدد';
}

// دالة مساعدة للفئة CSS
function getStatusClass(status) {
    const classMap = {
        'online': '',
        'stopped': 'offline',
        'not_found': 'error',
        'unknown': 'unknown'
    };
    return classMap[status] || 'unknown';
}

// ✨ تمييز النص المطابق - مُحسن
function highlightSearchTerm(text, searchTerm) {
    if (!searchTerm || !searchTerm.trim()) {
        return text;
    }
    
    try {
        // تنظيف النص للبحث الآمن
        const cleanSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${cleanSearchTerm})`, 'gi');
        
        return text.replace(regex, '<mark style="background: #ffeb3b; padding: 2px 4px; border-radius: 3px; font-weight: 600;">$1</mark>');
    } catch (error) {
        console.error('خطأ في تمييز النص:', error);
        return text;
    }
}

// دالة تبديل حالة البوت
async function toggleBot(botName) {
    try {
        console.log(`🔄 Toggle البوت: ${botName}`);
        
        // تعطيل الزر مؤقتاً
        const toggleElement = document.querySelector(`[data-bot="${botName}"] .toggle-switch`);
        if (toggleElement) {
            toggleElement.style.pointerEvents = 'none';
            toggleElement.style.opacity = '0.6';
        }
        
        const response = await fetch(`/toggle-bot/${botName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log(`📥 Toggle Response: ${response.status}`);

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('📊 نتيجة Toggle:', result);

        if (result.success) {
            // تحديث فوري للحالة
            const bot = activeBots.find(b => b.name === botName);
            if (bot) {
                bot.status = result.status;
                console.log(`✅ تحديث حالة ${botName}: ${result.status}`);
            }
            
            updateStats();
            applyFilters(); // إعادة تطبيق المرشحات للحفاظ على البحث
            showToast(result.message, 'success');
        } else {
            console.error('❌ خطأ في Toggle:', result);
            showToast(`❌ ${result.error || 'خطأ غير معروف'}`, 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في Toggle:', error);
        showToast(`❌ فشل في تغيير حالة البوت: ${error.message}`, 'error');
    } finally {
        // إعادة تفعيل الزر
        const toggleElement = document.querySelector(`[data-bot="${botName}"] .toggle-switch`);
        if (toggleElement) {
            toggleElement.style.pointerEvents = 'auto';
            toggleElement.style.opacity = '1';
        }
    }
}

// دالة إعادة تشغيل البوت
async function restartBot(botName) {
    if (!confirm(`هل تريد إعادة تشغيل البوت "${botName}"؟\nقد يستغرق الأمر بضع ثوانِ.`)) {
        return;
    }

    try {
        console.log(`🔄 إعادة تشغيل البوت: ${botName}`);
        
        // تعطيل الزر وإضافة مؤشر التحميل
        const button = document.querySelector(`[data-bot="${botName}"] .btn-restart`);
        if (button) {
            button.classList.add('btn-loading');
            button.disabled = true;
        }
        
        showToast(`🔄 جاري إعادة تشغيل ${botName}...`, 'info');
        
        const response = await fetch(`/restart-bot/${botName}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('📊 نتيجة إعادة التشغيل:', result);

        if (result.success) {
            showToast(result.message, 'success');
            setTimeout(loadBots, 3000);
        } else {
            showToast(`❌ ${result.error || 'فشل في إعادة التشغيل'}`, 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في إعادة التشغيل:', error);
        showToast(`❌ فشل في إعادة التشغيل: ${error.message}`, 'error');
    } finally {
        // إعادة تفعيل الزر
        const button = document.querySelector(`[data-bot="${botName}"] .btn-restart`);
        if (button) {
            button.classList.remove('btn-loading');
            button.disabled = false;
        }
    }
}

// دالة حذف بوت
async function deleteBot(botName) {
    const confirmation = confirm(
        `⚠️ تحذير: هل أنت متأكد من حذف البوت "${botName}" نهائياً؟\n\n` +
        `سيتم حذف:\n` +
        `• جميع ملفات البوت\n` +
        `• البيانات المحفوظة\n` +
        `• إعدادات PM2\n\n` +
        `هذا الإجراء لا يمكن التراجع عنه!`
    );

    if (!confirmation) return;

    try {
        console.log(`🗑️ حذف البوت: ${botName}`);
        
        showToast(`🗑️ جاري حذف ${botName}...`, 'info');

        const response = await fetch(`/delete-bot/${botName}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const result = await response.json();
        console.log('📊 نتيجة الحذف:', result);

        if (result.success) {
            showToast(result.message, 'success');
            loadBots(); // إعادة تحميل جميع البوتات
        } else {
            showToast(`❌ ${result.error || 'فشل في حذف البوت'}`, 'error');
        }
    } catch (error) {
        console.error('❌ خطأ في الحذف:', error);
        showToast(`❌ فشل في حذف البوت: ${error.message}`, 'error');
    }
}

// دالة إظهار/إخفاء شاشة التحميل
function showLoading(show, text = 'جاري التحميل...', progress = 0) {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');
    
    if (overlay) {
        overlay.style.display = show ? 'flex' : 'none';
        
        if (show && loadingText) {
            loadingText.textContent = text;
        }
        
        updateProgress(progress);
    }
}

// ✨ دالة عرض التوست المُحسنة
function showToast(message, type = 'info', duration = 4000) {
    // البحث عن أو إنشاء حاوي التوست
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1001;
            max-width: 400px;
        `;
        document.body.appendChild(container);
    }

    // إنشاء عنصر التوست
    const toast = document.createElement('div');
    toast.className = `message-toast ${type}`;
    
    // الألوان حسب النوع
    const colors = {
        'success': '#4CAF50',
        'error': '#f44336',
        'info': '#2196F3',
        'warning': '#ff9800'
    };
    
    toast.innerHTML = `
        <span>${getMessageIcon(type)}</span>
        <span>${message}</span>
    `;
    
    toast.style.cssText = `
        background: ${colors[type] || colors.info};
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        margin-bottom: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        word-wrap: break-word;
        max-width: 100%;
        font-weight: 500;
    `;

    container.appendChild(toast);

    // إزالة تلقائية
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);

    console.log(`📢 Toast: ${type} - ${message}`);
}

// دالة مساعدة للأيقونات
function getMessageIcon(type) {
    const icons = {
        'success': '✅',
        'error': '❌',
        'info': 'ℹ️',
        'warning': '⚠️'
    };
    return icons[type] || 'ℹ️';
}

// دالة تنسيق التاريخ
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            return 'تاريخ غير صالح';
        }
        
        return date.toLocaleString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        console.error('خطأ في تنسيق التاريخ:', error);
        return 'تاريخ غير متاح';
    }
}

// إضافة CSS للأنيميشن
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { 
            transform: translateX(100%); 
            opacity: 0; 
        }
        to { 
            transform: translateX(0); 
            opacity: 1; 
        }
    }
    
    @keyframes slideOut {
        from { 
            transform: translateX(0); 
            opacity: 1; 
        }
        to { 
            transform: translateX(100%); 
            opacity: 0; 
        }
    }
    
    @keyframes searchHighlight {
        0% { 
            background: #fff3e0; 
            transform: scale(1.02); 
        }
        100% { 
            background: #f8f9fa; 
            transform: scale(1); 
        }
    }
    
    .search-highlight {
        animation: searchHighlight 0.6s ease;
    }
    
    /* تحسين مظهر Toggle عند التعطيل */
    .toggle-switch[style*="pointer-events: none"] {
        cursor: not-allowed !important;
    }
    
    /* تحسين أنيميشن الأزرار */
    .btn-loading {
        position: relative;
        color: transparent !important;
    }
    
    .btn-loading::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 16px;
        height: 16px;
        border: 2px solid transparent;
        border-top: 2px solid currentColor;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        color: white;
    }
    
    @keyframes spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
`;
document.head.appendChild(style);

// معالجة الأخطاء العامة
window.addEventListener('error', function(e) {
    console.error('❌ خطأ JavaScript:', e.error);
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('❌ Promise مرفوض:', e.reason);
});

// تنظيف الموارد عند إغلاق الصفحة
window.addEventListener('beforeunload', function() {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
    if (searchTimeout) {
        clearTimeout(searchTimeout);
    }
});

console.log('✅ تم تحميل script.js مع البحث المُصحح بنجاح');
