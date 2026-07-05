const { createApp, ref, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        // --- State ---
        const screen = ref('start'); 
        const inputBuffer = ref(''); 
        const loading = ref(false);
        const loadingText = ref('');
        const lastAction = ref('none'); 
        const startMileage = ref(0);
        const logs = ref([]);
        const vehicleNumber = ref('');
        const vehicleNumberHistory = ref([]);
        const vehicleNumberInput = ref(null);
        const startTime = ref('');
        const undoStack = ref([]);
        
        // History & Settings
        const historyList = ref([]);
        const viewingHistoryMode = ref(false);
        const historyData = ref(null);
        const showSettings = ref(false);
        
        // Edit Mode State
        const isEditing = ref(false);
        const editBuffer = ref({
            startTime: '',
            startMileage: 0,
            groups: []
        });

        // UI Temps
        const showCopyToast = ref(false);
        const tempAddress = ref('');
        const tempTime = ref('');
        const currentHistoryPage = ref(0);
        
        // Departure Modal Data
        const tempDepartureTime = ref('');
        const tempDestinationName = ref('');
        const tempPaymentMethod = ref('現金');
        const tempRemarks = ref('');
        const paymentOptions = ['現金', 'カード', '請求書', 'web', '該当なし'];
        
        // Intelligent History Feature
        const showCandidateList = ref(false);
        const filteredCandidates = ref([]);

        // GPS Intelligence
        const tempLat = ref(null);
        const tempLon = ref(null);
        const savedLocations = ref([]);

        // --- Initialization ---
        onMounted(() => {
            document.getElementById('app').style.display = ''; 
            const now = new Date();
            startTime.value = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

            // Load Data
            const savedData = localStorage.getItem('nippoData_pro_v3');
            if (savedData) {
                try {
                    const parsed = JSON.parse(savedData);
                    screen.value = parsed.screen;
                    startMileage.value = parsed.startMileage || 0;
                    logs.value = parsed.logs || [];
                    lastAction.value = parsed.lastAction || 'none';
                    if (parsed.startTime) startTime.value = parsed.startTime;
                    if (parsed.undoStack) undoStack.value = parsed.undoStack;
                } catch(e) {
                    console.error('Data corrupted, reset');
                    // 【修正 #2】破損時にユーザーへ通知
                    alert('作業中データの読み込みに失敗しました。初期状態で開始します。');
                }
            }

            const savedHistory = localStorage.getItem('nippoHistory_v2');
            if (savedHistory) {
                // 【修正 #2】履歴データにもエラーハンドリング追加
                try {
                    historyList.value = JSON.parse(savedHistory);
                } catch(e) {
                    console.error('History data corrupted');
                    alert('履歴データの読み込みに失敗しました。履歴は空の状態です。');
                }
            }

            const savedVehicleNo = localStorage.getItem('nippoVehicleNo');
            if (savedVehicleNo) vehicleNumber.value = savedVehicleNo;
            const savedVehicleNoHistory = localStorage.getItem('nippoVehicleNoHistory');
            if (savedVehicleNoHistory) {
                try {
                    const parsedHistory = JSON.parse(savedVehicleNoHistory);
                    if (Array.isArray(parsedHistory)) {
                        vehicleNumberHistory.value = parsedHistory
                            .map(v => String(v || '').replace(/\D/g, '').slice(0, 4))
                            .filter(Boolean);
                    }
                } catch (e) { console.error('Vehicle history corrupted, reset'); }
            }

            const loadedLocations = localStorage.getItem('nippoLocations');
            if (loadedLocations) {
                // 【修正 #2】配送先データにもエラーハンドリング追加
                try {
                    savedLocations.value = JSON.parse(loadedLocations);
                } catch(e) {
                    console.error('Location data corrupted');
                }
            }
        });

        // --- Helper: Grouping Logic ---
        const createGroups = (logArray) => {
            const groups = [];
            let currentGroup = null;
            logArray.forEach(log => {
                if (log.type === 'arrival') {
                    currentGroup = { arrival: { ...log }, departure: null };
                    groups.push(currentGroup);
                } else if (log.type === 'departure') {
                    if (currentGroup) currentGroup.departure = { ...log };
                    else groups.push({ arrival: null, departure: { ...log } });
                    currentGroup = null;
                }
            });
            return groups;
        };

        // --- Computed for Groups ---
        const groupedLogs = computed(() => {
            const targetLogs = viewingHistoryMode.value ? (historyData.value?.logs || []) : logs.value;
            return createGroups(targetLogs);
        });

        // --- Editing Logic ---
        const enterEditMode = () => {
            const sourceStartKm = viewingHistoryMode.value ? historyData.value.startMileage : startMileage.value;
            const sourceStartTime = viewingHistoryMode.value ? historyData.value.startTime : startTime.value;
            const sourceLogs = viewingHistoryMode.value ? historyData.value.logs : logs.value;

            editBuffer.value = {
                startMileage: sourceStartKm,
                startTime: sourceStartTime,
                groups: createGroups(sourceLogs) 
            };
            isEditing.value = true;
        };

        const removeGroupFromBuffer = (index) => {
            if(confirm('この案件を削除しますか？\n（以降の案件番号は自動的に詰められます）')) {
                editBuffer.value.groups.splice(index, 1);
            }
        };

        const saveEditMode = () => {
            if(!confirm('変更を保存しますか？')) return;

            const newLogs = [];
            editBuffer.value.groups.forEach(group => {
                if(group.arrival) newLogs.push({ ...group.arrival, type: 'arrival' });
                if(group.departure) newLogs.push({ ...group.departure, type: 'departure' });
            });

            if (viewingHistoryMode.value) {
                historyData.value.startMileage = editBuffer.value.startMileage;
                historyData.value.startTime = editBuffer.value.startTime;
                historyData.value.logs = newLogs;
                const lastLog = newLogs.filter(l => l.type === 'arrival' && l.mileage).pop();
                const lastKm = lastLog ? lastLog.mileage : 0;
                historyData.value.totalDistance = (lastKm > 0) ? (lastKm - editBuffer.value.startMileage) : 0;
                
                // 【修正 #3】ディープコピーした historyData の変更を元の historyList に反映
                const originalIndex = historyList.value.findIndex(item =>
                    item.dateStr === historyData.value.dateStr &&
                    item.startTime === historyData.value.startTime
                );
                if (originalIndex !== -1) {
                    historyList.value[originalIndex] = JSON.parse(JSON.stringify(historyData.value));
                }
                updateHistoryStorage();
            } else {
                startMileage.value = editBuffer.value.startMileage;
                startTime.value = editBuffer.value.startTime;
                logs.value = newLogs;
                saveData();
            }

            isEditing.value = false;
        };

        const cancelEditMode = () => {
            if(confirm('編集を破棄して戻りますか？')) {
                isEditing.value = false;
                editBuffer.value = { startTime: '', startMileage: 0, groups: [] };
            }
        };

        // --- Computed for Edit Mode Stats ---
        const getEditLastMileage = computed(() => {
            const groups = editBuffer.value.groups;
            for (let i = groups.length - 1; i >= 0; i--) {
                if (groups[i].arrival && groups[i].arrival.mileage) {
                    return groups[i].arrival.mileage;
                }
            }
            return '---';
        });

        const calculateEditTotalDistance = computed(() => {
            const last = getEditLastMileage.value;
            if (last === '---') return 0;
            return Number(last) - Number(editBuffer.value.startMileage);
        });


        // --- Keypad Functions ---
        const appendDigit = (n) => {
            if (inputBuffer.value.length >= 6) return;
            inputBuffer.value += n.toString();
        };
        const removeDigit = () => {
            if (inputBuffer.value.length > 0) {
                inputBuffer.value = inputBuffer.value.slice(0, -1);
            }
        };
        
        const getDisplayDigit = (i) => {
            const maxDigits = 6;
            const currentLength = inputBuffer.value.length;
            const emptySlots = maxDigits - currentLength;
            
            if (i <= emptySlots) return '';
            else return inputBuffer.value[i - emptySlots - 1];
        };

        // --- Save & Storage ---
        const saveData = () => {
            const data = { 
                screen: screen.value, 
                startMileage: startMileage.value, 
                logs: logs.value, 
                lastAction: lastAction.value, 
                startTime: startTime.value,
                undoStack: undoStack.value
            };
            localStorage.setItem('nippoData_pro_v3', JSON.stringify(data));
        };
        const updateHistoryStorage = () => localStorage.setItem('nippoHistory_v2', JSON.stringify(historyList.value));
        const moveVehicleCaretToEnd = async () => {
            await nextTick();
            const inputEl = vehicleNumberInput.value;
            if (!inputEl || typeof inputEl.setSelectionRange !== 'function') return;
            const end = (vehicleNumber.value || '').length;
            inputEl.setSelectionRange(end, end);
        };

        const saveVehicleNumber = () => localStorage.setItem('nippoVehicleNo', vehicleNumber.value);
        const saveVehicleNumberHistory = () => localStorage.setItem('nippoVehicleNoHistory', JSON.stringify(vehicleNumberHistory.value));
        const addVehicleNumberToHistory = (no) => {
            const normalized = String(no || '').replace(/\D/g, '').slice(0, 4);
            if (!normalized) return;
            const withoutCurrent = vehicleNumberHistory.value.filter(item => item !== normalized);
            vehicleNumberHistory.value = [normalized, ...withoutCurrent].slice(0, 8);
            saveVehicleNumberHistory();
        };
        const selectVehicleNumber = async (no) => {
            vehicleNumber.value = String(no || '').replace(/\D/g, '').slice(0, 4);
            saveVehicleNumber();
            addVehicleNumberToHistory(vehicleNumber.value);
            await moveVehicleCaretToEnd();
        };
        const removeVehicleNumberFromHistory = (no) => {
            vehicleNumberHistory.value = vehicleNumberHistory.value.filter(item => item !== no);
            saveVehicleNumberHistory();
        };
        const saveLocations = () => localStorage.setItem('nippoLocations', JSON.stringify(savedLocations.value));

        // --- Backup & Restore ---
        const downloadBackup = () => {
            const backupData = {
                history: historyList.value,
                locations: savedLocations.value,
                vehicleNo: vehicleNumber.value,
                vehicleNoHistory: vehicleNumberHistory.value,
                version: '3.9'
            };
            const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nippo_backup_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        const restoreBackup = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(confirm('現在のデータを上書きして復元しますか？\n（現在の履歴は消えます）')) {
                        if(data.history) historyList.value = data.history;
                        if(data.locations) savedLocations.value = data.locations;
                        if(data.vehicleNo) vehicleNumber.value = data.vehicleNo;
                        if(Array.isArray(data.vehicleNoHistory)) {
                            vehicleNumberHistory.value = data.vehicleNoHistory
                                .map(v => String(v || '').replace(/\D/g, '').slice(0, 4))
                                .filter(Boolean)
                                .slice(0, 8);
                        }
                        updateHistoryStorage();
                        saveVehicleNumber();
                        saveVehicleNumberHistory();
                        saveLocations();
                        alert('復元が完了しました。');
                        showSettings.value = false;
                    }
                } catch (err) {
                    alert('ファイル形式が正しくありません。');
                }
            };
            reader.readAsText(file);
        };

        // --- Undo & Navigation Logic ---
        const saveStateForUndo = () => {
            if (undoStack.value.length > 10) undoStack.value.shift();
            undoStack.value.push({
                logs: JSON.parse(JSON.stringify(logs.value)),
                lastAction: lastAction.value,
                startMileage: startMileage.value 
            });
        };

        const undo = () => {
            if (undoStack.value.length === 0) return;
            const prevState = undoStack.value.pop();
            logs.value = prevState.logs;
            lastAction.value = prevState.lastAction;
            startMileage.value = prevState.startMileage;
            saveData();
        };

        const handleHeaderBack = () => {
            if (undoStack.value.length > 0) {
                undo();
            } else {
                if (confirm('業務開始を取り消してトップ画面に戻りますか？\n（入力内容はリセットされます）')) {
                    screen.value = 'start';
                    inputBuffer.value = ''; 
                    logs.value = [];
                    lastAction.value = 'none';
                    startMileage.value = 0;
                    saveData();
                }
            }
        };

        // --- GPS & Math ---
        const getDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371000; 
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLon/2) * Math.sin(dLon/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        };

        const getCurrentLocation = () => {
            return new Promise((resolve) => {
                if (!navigator.geolocation) { resolve({ address: '位置情報非対応', lat: null, lon: null }); return; }
                const timeoutId = setTimeout(() => {
                    resolve({ address: '取得タイムアウト', lat: null, lon: null });
                }, 10000); 
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    clearTimeout(timeoutId);
                    try {
                        const lat = pos.coords.latitude;
                        const lon = pos.coords.longitude;
                        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`, {
                            headers: { 'Accept-Language': 'ja', 'User-Agent': 'SmartLogPro/3.9 (Personal Use)' }
                        });
                        if (!res.ok) throw new Error('API Error');
                        const data = await res.json();
                        const a = data.address || {};

                        const cityStart = a.city || a.town || a.village || a.municipality || a.county || '';
                        const areaParts = [
                            a.city_district,
                            a.ward,
                            a.suburb,
                            a.quarter,
                            a.neighbourhood,
                            a.block,
                            a.residential,
                            a.hamlet,
                            a.road,
                            a.house_number,
                            a.building
                        ].filter(Boolean);
                        const formatted = [...new Set([cityStart, ...areaParts].filter(Boolean))].join('');
                        resolve({ address: formatted || data.display_name?.replace(/^.*?[都道府県]\s*/, '') || '住所不明', lat, lon });
                    } catch (e) { resolve({ address: '住所取得エラー', lat: null, lon: null }); }
                }, (err) => {
                    clearTimeout(timeoutId);
                    resolve({ address: '位置情報取得失敗', lat: null, lon: null });
                }, { enableHighAccuracy: true, timeout: 9000 });
            });
        };

        // --- Core Actions ---
        const startWork = () => {
            startMileage.value = Number(inputBuffer.value);
            logs.value = [];
            undoStack.value = [];
            inputBuffer.value = '';
            lastAction.value = 'start';
            screen.value = 'dashboard';
            addVehicleNumberToHistory(vehicleNumber.value);
            saveData();
        };

        const handleArrival = async () => {
            loading.value = true;
            loadingText.value = '位置情報を取得中...';
            // 【修正 #7】同期処理を Promise.all から分離
            const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            const loc = await getCurrentLocation();
            tempTime.value = time;
            tempAddress.value = loc.address;
            tempLat.value = loc.lat;
            tempLon.value = loc.lon;
            loading.value = false;
            screen.value = 'mileage_check';
            inputBuffer.value = '';
        };

        const confirmArrival = () => {
            saveStateForUndo();
            logs.value.push({ 
                type: 'arrival', 
                time: tempTime.value, 
                address: tempAddress.value, 
                mileage: Number(inputBuffer.value) 
            });
            lastAction.value = 'arrival';
            screen.value = 'dashboard';
            inputBuffer.value = '';
            saveData();
        };

        const cancelModal = () => {
            screen.value = 'dashboard';
            inputBuffer.value = '';
            showCandidateList.value = false;
        };

        // --- Departure & History Logic ---
        const handleDeparture = () => {
            tempDepartureTime.value = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            tempDestinationName.value = '';
            tempPaymentMethod.value = '現金';
            tempRemarks.value = '';
            showCandidateList.value = false;
            screen.value = 'departure_check';
        };

        const toggleCandidateList = () => {
            showCandidateList.value = !showCandidateList.value;
            if (showCandidateList.value && tempLat.value && tempLon.value) {
                const nearby = savedLocations.value.filter(loc => 
                    getDistance(tempLat.value, tempLon.value, loc.lat, loc.lon) < 150
                );
                const seenNames = new Set();
                const uniqueCandidates = [];
                nearby.forEach(loc => {
                    if (!seenNames.has(loc.name)) {
                        seenNames.add(loc.name);
                        uniqueCandidates.push(loc);
                    }
                });
                filteredCandidates.value = uniqueCandidates;
            } else {
                filteredCandidates.value = [];
            }
        };

        const selectCandidate = (name) => {
            tempDestinationName.value = name;
            showCandidateList.value = false;
        };
        
        const deleteCandidate = (candidate) => {
            if(!confirm(`履歴「${candidate.name}」を削除しますか？`)) return;
            savedLocations.value = savedLocations.value.filter(loc => 
                !(loc.name === candidate.name && Math.abs(loc.lat - candidate.lat) < 0.0001 && Math.abs(loc.lon - candidate.lon) < 0.0001)
            );
            saveLocations();
            toggleCandidateList(); 
            showCandidateList.value = true;
        };

        const confirmDeparture = () => {
            saveStateForUndo();
            if (tempDestinationName.value && tempLat.value) {
                const alreadyExists = savedLocations.value.some(loc => 
                    loc.name === tempDestinationName.value &&
                    getDistance(tempLat.value, tempLon.value, loc.lat, loc.lon) < 100
                );
                if (!alreadyExists) {
                    savedLocations.value.push({ 
                        lat: tempLat.value, 
                        lon: tempLon.value, 
                        name: tempDestinationName.value 
                    });
                    saveLocations();
                }
            }
            logs.value.push({ 
                type: 'departure', 
                time: tempDepartureTime.value,
                destination: tempDestinationName.value,
                payment: tempPaymentMethod.value,
                remarks: tempRemarks.value
            });
            lastAction.value = 'departure';
            screen.value = 'dashboard';
            saveData();
        };

        // --- Other Logic ---
        const goToSummary = () => { screen.value = 'summary'; saveData(); };
        const backToDashboard = () => { screen.value = 'dashboard'; saveData(); };
        
        const closeSubScreens = () => {
            if(isEditing.value) return; 
            viewingHistoryMode.value = false;
            showSettings.value = false;
            historyData.value = null;
            if (screen.value !== 'start') screen.value = 'start';
        };

        const saveAndReset = () => {
            if(!confirm('本日の業務を完了しますか？')) return;
            const todayStr = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
            historyList.value.unshift({
                dateStr: todayStr,
                startMileage: startMileage.value,
                startTime: startTime.value,
                logs: logs.value,
                totalDistance: calculateTotalDistance.value
            });
            updateHistoryStorage();
            localStorage.removeItem('nippoData_pro_v3');
            
            // リセット
            screen.value = 'start';
            startMileage.value = 0;
            logs.value = [];
            undoStack.value = [];
            lastAction.value = 'none';
            inputBuffer.value = '';
            startTime.value = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        };

        // 【修正 #4】アイテム参照で削除（インデックス計算のズレを防止）
        const deleteHistoryItem = (item) => {
            if(!confirm('この履歴を削除しますか？')) return;
            const index = historyList.value.indexOf(item);
            if (index !== -1) {
                historyList.value.splice(index, 1);
                updateHistoryStorage();
            }
        };
        const clearAllHistory = () => {
            if(!confirm('【警告】日報の履歴データを全て削除しますか？')) return;
            historyList.value = [];
            updateHistoryStorage();
            showSettings.value = false;
        };
        const clearLocations = () => {
            if(!confirm('【警告】学習した配送先リストを全て削除しますか？')) return;
            savedLocations.value = [];
            saveLocations();
            alert('配送先履歴をリセットしました。');
            showSettings.value = false;
        };

        const copyToClipboard = () => {
            const targetLogs = viewingHistoryMode.value ? historyData.value.logs : logs.value;
            const targetStartKm = viewingHistoryMode.value ? historyData.value.startMileage : startMileage.value;
            const targetStartTime = viewingHistoryMode.value ? historyData.value.startTime : startTime.value;
            const targetDate = viewingHistoryMode.value ? historyData.value.dateStr : new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
            
            const exportGroups = createGroups(targetLogs);
            
            let targetEndKm = '---';
            let targetEndTime = '';
            const lastLog = targetLogs.length > 0 ? targetLogs[targetLogs.length - 1] : null;
            if(lastLog) targetEndTime = lastLog.time;
            
            const arrivalLogs = targetLogs.filter(l => l.type === 'arrival' && l.mileage);
            if(arrivalLogs.length) targetEndKm = arrivalLogs[arrivalLogs.length - 1].mileage;

            let data = [];
            data.push(`DATE::${targetDate}`);
            data.push(`START_KM::${targetStartKm}`);
            data.push(`END_KM::${targetEndKm}`);
            data.push(`START_TIME::${targetStartTime}`);
            data.push(`END_TIME::${targetEndTime}`);
            data.push(`VEHICLE_NO::${vehicleNumber.value}`);

            exportGroups.forEach((group, index) => {
                if (index >= 8) return; 
                const num = index + 1;
                const arr = group.arrival || {};
                const dep = group.departure || {};
                data.push(`CASE_${num}_ADDRESS::${arr.address || ''}`);
                data.push(`CASE_${num}_ARR_TIME::${arr.time || ''}`);
                data.push(`CASE_${num}_ARR_KM::${arr.mileage || ''}`);
                data.push(`CASE_${num}_DEST::${dep.destination || ''}`);
                data.push(`CASE_${num}_DEP_TIME::${dep.time || ''}`);
                data.push(`CASE_${num}_PAY::${dep.payment || ''}`);
                data.push(`CASE_${num}_NOTE::${dep.remarks || ''}`);
            });

            navigator.clipboard.writeText(data.join('\n')).then(() => {
                showCopyToast.value = true;
                setTimeout(() => showCopyToast.value = false, 2000);
            });
        };

        // 【修正 #3】ディープコピーで履歴を閲覧（元データを直接変更しない）
        const viewHistory = (item) => {
            viewingHistoryMode.value = true;
            historyData.value = JSON.parse(JSON.stringify(item));
            screen.value = 'summary';
        };

        // Computed Stats
        const activeLogs = computed(() => viewingHistoryMode.value ? historyData.value?.logs || [] : logs.value);
        const activeStart = computed(() => viewingHistoryMode.value ? historyData.value?.startMileage || 0 : startMileage.value);
        
        const getStatusText = computed(() => {
            if (lastAction.value === 'arrival') {
                const caseNum = logs.value.filter(l => l.type === 'arrival').length;
                return `案件${caseNum}を作業中`;
            } else {
                const finishedCount = logs.value.filter(l => l.type === 'departure').length;
                return `案件${finishedCount + 1}へ移動中`;
            }
        });

        const getLastMileage = computed(() => {
            const arr = activeLogs.value.filter(l => l.type === 'arrival' && l.mileage);
            return arr.length ? arr[arr.length - 1].mileage : '---';
        });

        const calculateTotalDistance = computed(() => {
            const last = getLastMileage.value;
            if (last === '---') return 0;
            return Number(last) - Number(activeStart.value);
        });

        const paginatedHistory = computed(() => {
            const start = currentHistoryPage.value * 5;
            return historyList.value.slice(start, start + 5);
        });
        const totalHistoryPages = computed(() => Math.ceil(historyList.value.length / 5));

        return {
            screen, inputBuffer, loading, loadingText, lastAction, startMileage,
            historyList, viewingHistoryMode, historyData, showCopyToast, showSettings,
            vehicleNumber, vehicleNumberHistory, vehicleNumberInput, moveVehicleCaretToEnd, saveVehicleNumber, selectVehicleNumber, removeVehicleNumberFromHistory, startTime, undoStack, undo, handleHeaderBack,
            
            // Keypad
            appendDigit, removeDigit, getDisplayDigit,

            // Modal & Data
            // 【修正 #6】tempLocation エイリアスを廃止し tempAddress に統一
            tempAddress, tempTime,
            tempDepartureTime, tempDestinationName, tempPaymentMethod, tempRemarks, paymentOptions,
            confirmDeparture, handleArrival, confirmArrival, cancelModal, handleDeparture,

            // History & Backup
            currentHistoryPage, totalHistoryPages, paginatedHistory,
            downloadBackup, restoreBackup, clearAllHistory, deleteHistoryItem, clearLocations,
            
            // Intelligent History
            showCandidateList, toggleCandidateList, selectCandidate, deleteCandidate, filteredCandidates,
            
            // Navigation
            startWork, goToSummary, backToDashboard, saveAndReset, viewHistory, closeSubScreens,
            groupedLogs, calculateTotalDistance, getLastMileage, copyToClipboard, getStatusText,

            // Edit Mode
            isEditing, editBuffer, enterEditMode, saveEditMode, cancelEditMode, removeGroupFromBuffer,
            getEditLastMileage, calculateEditTotalDistance
        };
    }
}).mount('#app');
