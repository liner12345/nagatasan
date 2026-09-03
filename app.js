const { createApp, ref, onMounted, computed, nextTick } = Vue;

createApp({
    setup() {
        // --- State ---
        const screen = ref('start'); 
        // SM-1 の5状態。localStorage から復元する値をこれで検証する
        const SCREENS = ['start', 'dashboard', 'mileage_check', 'departure_check', 'summary'];
        const inputBuffer = ref(''); 
        const loading = ref(false);
        const loadingText = ref('');
        const lastAction = ref('none'); 
        const startMileage = ref(0);
        const logs = ref([]);
        const vehicleNumber = ref('');
        const vehicleNumberHistory = ref([]);
        const vehicleNumberInput = ref(null);
        const vehiclePick = ref('');   // 履歴プルダウンの選択値。選ぶたびに空へ戻す
        const startTime = ref('');
        const undoStack = ref([]);
        const driverName = ref('');

        // 当日実績（日報の黄色セル C19〜C24）。キー名は fmt.fare_parts() の引数と同じ。
        // 空文字は「未入力」で、0 とは区別する（回収距離は未入力なら 0 円、0 なら 2,000 円）
        const DAILY_FIELDS = [
            { key: 'kaisyuKm', label: '①回収距離', unit: 'km' },
            { key: 'hako',     label: '①回収箱数', unit: '箱' },
            { key: 'shoku',    label: '②配達数',   unit: '食' },
            { key: 'tsuika',   label: '③追加配達', unit: '件' },
            { key: 'taiki',    label: '④作業・待機', unit: '分' },
            { key: 'kaki',     label: '⑤夏季手当', unit: '円' }
        ];
        const emptyDaily = () => {
            const d = {};
            DAILY_FIELDS.forEach((f) => { d[f.key] = ''; });
            return d;
        };
        const daily = ref(emptyDaily());

        // History & Settings
        const historyList = ref([]);
        const viewingHistoryMode = ref(false);
        const historyData = ref(null);
        const showSettings = ref(false);
        
        // Edit Mode State
        const isEditing = ref(false);
        // まだ historyList に無い新規レコード(記録し忘れた過去日)を編集中か
        const isNewPastEntry = ref(false);
        // 編集中の履歴が historyList の何番目か。-1 は新規または当日の進行中データ
        const editingIndex = ref(-1);
        const editBuffer = ref({
            startTime: '',
            startMileage: 0,
            groups: []
        });

        // UI Temps
        const showCopyToast = ref(false);
        const showTextToast = ref(false);
        const tempAddress = ref('');
        const tempTime = ref('');
        // 立替。空文字のまま確定したら記録しない(0 と未入力を区別する)
        const tempTollFee = ref('');
        const tempParkingFee = ref('');
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
        const tempAccuracy = ref(null);
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
                    screen.value = SCREENS.includes(parsed.screen) ? parsed.screen : 'start';
                    startMileage.value = parsed.startMileage || 0;
                    logs.value = parsed.logs || [];
                    lastAction.value = parsed.lastAction || 'none';
                    if (parsed.startTime) startTime.value = parsed.startTime;
                    if (parsed.undoStack) undoStack.value = parsed.undoStack;
                    if (parsed.daily) daily.value = Object.assign(emptyDaily(), parsed.daily);
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
                    const parsed = JSON.parse(savedHistory);
                    historyList.value = Array.isArray(parsed) ? parsed : [];
                } catch(e) {
                    console.error('History data corrupted');
                    alert('履歴データの読み込みに失敗しました。履歴は空の状態です。');
                }
            }

            const savedVehicleNo = localStorage.getItem('nippoVehicleNo');
            if (savedVehicleNo) vehicleNumber.value = savedVehicleNo;
            driverName.value = localStorage.getItem('nippoDriverName') || '';
            // 夏季手当だけは日をまたいで同じ額が続くので、前回値を初期値にする。
            // 初回は 500 = 日報様式(build_nippo)の C24 の既定値に合わせる
            const savedKaki = localStorage.getItem('nippoKakiFee');
            if (daily.value.kaki === '') daily.value.kaki = savedKaki !== null ? savedKaki : 500;
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
                    const parsed = JSON.parse(loadedLocations);
                    savedLocations.value = Array.isArray(parsed) ? parsed : [];
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

        // --- 日付の書式 ---
        // 履歴の dateStr は 'YYYY/MM/DD(曜)'。自動記帳キット(01_nippo.py)が先頭の
        // YYYY/MM/DD を正規表現で読むため、この形式を崩すと日報に出なくなる
        const formatDateStr = (d) => d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
        const dateStrToInput = (str) => {
            const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(str || '');
            return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
        };
        const inputToDateStr = (val) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val || '');
            return m ? formatDateStr(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : '';
        };
        // <input type="date"> は YYYY-MM-DD しか扱えないので変換して橋渡しする
        const editDateInput = computed({
            get: () => dateStrToInput(editBuffer.value.dateStr),
            set: (val) => { const str = inputToDateStr(val); if (str) editBuffer.value.dateStr = str; }
        });

        // 履歴は新しい順に並べる。過去日を後から足しても正しい位置に入る
        const sortHistory = () => {
            const key = (item) => {
                const m = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(item.dateStr || '');
                return (m ? m[1] + m[2] + m[3] : '00000000') + (item.startTime || '');
            };
            historyList.value.sort((a, b) => key(b).localeCompare(key(a)));
        };

        // --- Editing Logic ---
        const enterEditMode = () => {
            const sourceStartKm = viewingHistoryMode.value ? historyData.value.startMileage : startMileage.value;
            const sourceStartTime = viewingHistoryMode.value ? historyData.value.startTime : startTime.value;
            const sourceLogs = viewingHistoryMode.value ? historyData.value.logs : logs.value;

            editBuffer.value = {
                // 日付を持つのは履歴レコードだけ。当日の進行中データの日付は
                // saveAndReset() のときに決まるので、ここでは編集させない
                dateStr: viewingHistoryMode.value ? historyData.value.dateStr : null,
                // 車番も日ごとに持つ。無い古い記録は現在の車番を初期値にする
                vehicleNo: viewingHistoryMode.value
                    ? (historyData.value.vehicleNo || vehicleNumber.value || '')
                    : null,
                startMileage: sourceStartKm,
                startTime: sourceStartTime,
                groups: createGroups(sourceLogs) 
            };
            isEditing.value = true;
        };

        const addGroupToBuffer = () => {
            editBuffer.value.groups.push({
                arrival:   { type: 'arrival',   time: '', address: '', mileage: 0, tollFee: '', parkingFee: '' },
                departure: { type: 'departure', time: '', destination: '', payment: '現金', remarks: '' }
            });
        };

        const removeGroupFromBuffer = (index) => {
            if(confirm('この案件を削除しますか？\n（以降の案件番号は自動的に詰められます）')) {
                editBuffer.value.groups.splice(index, 1);
            }
        };

        const saveEditMode = () => {
            if (viewingHistoryMode.value) {
                if (!/^\d{4}\/\d{2}\/\d{2}/.test(editBuffer.value.dateStr || '')) {
                    alert('日付が正しくありません。'); return;
                }
                if (dateStrToInput(editBuffer.value.dateStr) > dateStrToInput(formatDateStr(new Date()))
                    && !confirm('未来の日付になっています。\nこのまま保存しますか？')) return;
            }
            if(!confirm('変更を保存しますか？')) return;

            const newLogs = [];
            editBuffer.value.groups.forEach(group => {
                if (group.arrival) {
                    const a = { ...group.arrival, type: 'arrival' };
                    // 入力欄から来た立替は文字列。数値にし、空や 0 はキーごと落とす
                    ['tollFee', 'parkingFee'].forEach((k) => {
                        const v = Number(a[k]);
                        if (Number.isFinite(v) && v > 0) a[k] = v;
                        else delete a[k];
                    });
                    newLogs.push(a);
                }
                if(group.departure) newLogs.push({ ...group.departure, type: 'departure' });
            });

            if (viewingHistoryMode.value) {
                historyData.value.dateStr = editBuffer.value.dateStr;
                historyData.value.vehicleNo = editBuffer.value.vehicleNo || '';
                historyData.value.startMileage = editBuffer.value.startMileage;
                historyData.value.startTime = editBuffer.value.startTime;
                historyData.value.logs = newLogs;
                const lastLog = newLogs.filter(l => l.type === 'arrival' && l.mileage).pop();
                const lastKm = lastLog ? lastLog.mileage : 0;
                historyData.value.totalDistance = (lastKm > 0) ? (lastKm - editBuffer.value.startMileage) : 0;

                // 同じ日付で開始距離まで同じだと 01_nippo.py が別シートに分けてしまう
                const dup = historyList.value.some((item, i) =>
                    i !== editingIndex.value &&
                    item.dateStr === historyData.value.dateStr &&
                    item.startMileage === historyData.value.startMileage
                );
                if (dup && !confirm('同じ日付・同じ開始距離の記録が既にあります。\nこのまま保存しますか？')) return;

                // 【修正】以前は編集後の dateStr + startTime で元レコードを探していたため、
                // 日付や開始時刻を変えると書き戻し先を見失い、変更が黙って消えていた。
                // 開いた時点のインデックスを使う
                const saved = JSON.parse(JSON.stringify(historyData.value));
                // 入力欄の当日実績は文字列。保存する側だけ数値にし、空欄のキーは落とす。
                // 画面が持つ historyData.daily は入力用に全キーを残しておく
                saved.daily = normalizeDaily(historyData.value.daily);
                if (isNewPastEntry.value) {
                    historyList.value.push(saved);
                } else if (editingIndex.value !== -1) {
                    historyList.value[editingIndex.value] = saved;
                }
                sortHistory();
                editingIndex.value = historyList.value.findIndex(item =>
                    item.dateStr === saved.dateStr &&
                    item.startTime === saved.startTime &&
                    item.startMileage === saved.startMileage
                );
                isNewPastEntry.value = false;
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
            if(!confirm('編集を破棄して戻りますか？')) return;
            isEditing.value = false;
            editBuffer.value = { dateStr: null, vehicleNo: null, startTime: '', startMileage: 0, groups: [] };
            if (isNewPastEntry.value) {
                // まだ履歴に入れていない新規レコードなので、丸ごと捨てて一覧へ戻る
                isNewPastEntry.value = false;
                viewingHistoryMode.value = false;
                historyData.value = null;
                editingIndex.value = -1;
                screen.value = 'start';
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
                undoStack: undoStack.value,
                daily: daily.value
            };
            localStorage.setItem('nippoData_pro_v3', JSON.stringify(data));
        };
        const saveDriverName = () => localStorage.setItem('nippoDriverName', driverName.value);

        // --- 当日実績（日報 C19〜C24 / format-spec §1） ---
        // 当日は daily、履歴を開いているときは historyData.daily を直接編集する。
        // JSON に載せるときは空欄のキーを落とす（0 と未入力を区別するため）。

        // 履歴を開くときに欠けているキーを補う。computed の中で書くと
        // 描画中に状態を変えることになるので、入口で1回だけ整える
        const fillDaily = (rec) => {
            const src = rec.daily || {};
            const out = emptyDaily();
            DAILY_FIELDS.forEach((f) => {
                if (src[f.key] !== undefined && src[f.key] !== null) out[f.key] = src[f.key];
            });
            rec.daily = out;
        };

        const activeDaily = computed(() => {
            if (!viewingHistoryMode.value || !historyData.value) return daily.value;
            return historyData.value.daily || daily.value;
        });

        const normalizeDaily = (src) => {
            const out = {};
            DAILY_FIELDS.forEach((f) => {
                const raw = src ? src[f.key] : '';
                if (raw === '' || raw === null || raw === undefined) return;
                const v = Number(raw);
                if (Number.isFinite(v)) out[f.key] = v;
            });
            return Object.keys(out).length ? out : undefined;
        };

        const dailyFilled = computed(() => !!normalizeDaily(activeDaily.value));

        const persistDaily = () => {
            const kaki = activeDaily.value.kaki;
            if (kaki !== '' && kaki !== null && kaki !== undefined) {
                localStorage.setItem('nippoKakiFee', String(kaki));
            }
            if (!viewingHistoryMode.value) { saveData(); return; }
            // 履歴を開いているときは、その場で書き戻す（編集モードを通さない）
            if (editingIndex.value !== -1 && historyList.value[editingIndex.value]) {
                historyList.value[editingIndex.value].daily = normalizeDaily(activeDaily.value);
                updateHistoryStorage();
            }
        };

        // 確認画面に出す当日の運賃。日報の C34 と同じ値になる
        const nippoFare = computed(() => {
            const km = calculateTotalDistance.value;
            const d = activeDaily.value;
            const n = (x) => (x === '' || x === null || x === undefined ? null : Number(x));
            const parts = NippoForm.fareParts(km, n(d.kaisyuKm), n(d.hako), n(d.shoku),
                                              n(d.tsuika), n(d.taiki), n(d.kaki), NippoForm.KIHON);
            return NippoForm.roundHalfEven(parts.total);
        });

        const tatekaeTotal = computed(() => {
            let sum = 0;
            activeLogs.value.forEach((l) => {
                sum += (Number(l.tollFee) || 0) + (Number(l.parkingFee) || 0);
            });
            return sum;
        });
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
        // 履歴はプルダウンで選ぶ。選んだら値を入力欄へ移し、選択状態は戻す
        // （同じ番号を選び直せるようにするため）
        const pickVehicleNumber = async () => {
            const no = vehiclePick.value;
            vehiclePick.value = '';
            if (no) await selectVehicleNumber(no);
        };
        const canForgetVehicleNumber = computed(() =>
            vehicleNumberHistory.value.indexOf(vehicleNumber.value) !== -1);
        const forgetVehicleNumber = () => {
            if (!canForgetVehicleNumber.value) return;
            if (!confirm(`車両No「${vehicleNumber.value}」を履歴から消しますか？`)) return;
            removeVehicleNumberFromHistory(vehicleNumber.value);
        };
        const saveLocations = () => localStorage.setItem('nippoLocations', JSON.stringify(savedLocations.value));

        // --- Backup & Restore ---
        const downloadBlob = (blob, name) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        };

        const downloadBackup = () => {
            const backupData = {
                history: historyList.value,
                locations: savedLocations.value,
                vehicleNo: vehicleNumber.value,
                vehicleNoHistory: vehicleNumberHistory.value,
                driverName: driverName.value,   // 日報 F3（format-spec §1）
                version: '3.9'
            };
            const blob = new Blob([JSON.stringify(backupData, null, 2)], {type: 'application/json'});
            downloadBlob(blob, `nippo_backup_${new Date().toISOString().slice(0,10)}.json`);
        };

        const restoreBackup = (event) => {
            const input = event.target;
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            // 同じファイルを選び直せるよう、結果に関わらず選択状態を必ず戻す
            const release = () => { input.value = ''; };
            reader.onerror = () => { alert('ファイルを読み込めませんでした。'); release(); };
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data || typeof data !== 'object' || !Array.isArray(data.history)) {
                        alert('日報のバックアップファイルではないようです。\n（history が入っていません）');
                        return;
                    }
                    if(confirm('現在のデータを上書きして復元しますか？\n（現在の履歴は消えます）')) {
                        historyList.value = data.history;
                        if(Array.isArray(data.locations)) savedLocations.value = data.locations;
                        if(typeof data.vehicleNo === 'string') vehicleNumber.value = data.vehicleNo;
                        if(typeof data.driverName === 'string') {
                            driverName.value = data.driverName;
                            saveDriverName();
                        }
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
                        sortHistory();
                        currentHistoryPage.value = 0;
                        alert('復元が完了しました。');
                        showSettings.value = false;
                    }
                } catch (err) {
                    alert('ファイル形式が正しくありません。');
                } finally {
                    release();
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

        // 端末は精度の粗い測位(Wi-Fi/基地局)を先に返すことがある。
        // watchPosition で精度が収束するのを待ち、最も良い1点だけを使う。
        // 逆ジオコーディングへのリクエストは従来どおり1到着につき1回。
        const GEO_ACCURACY_TARGET = 50;    // この誤差(m)以下になったら即採用
        const GEO_MAX_WAIT = 12000;        // 収束しなくてもここで打ち切る(ms)
        const GEOCODE_MIN_INTERVAL = 1100; // Nominatim の上限は毎秒1リクエスト
        let lastGeocodeAt = 0;

        const acquirePosition = (onProgress) => {
            return new Promise((resolve) => {
                let best = null;
                let watchId = null;
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
                    resolve(best);
                };
                const timer = setTimeout(finish, GEO_MAX_WAIT);
                watchId = navigator.geolocation.watchPosition((pos) => {
                    if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
                    if (onProgress) onProgress(best.coords.accuracy);
                    if (best.coords.accuracy <= GEO_ACCURACY_TARGET) finish();
                }, () => {
                    // 途中で失敗しても、それまでに得た最良点があれば使う
                    finish();
                }, { enableHighAccuracy: true, timeout: GEO_MAX_WAIT, maximumAge: 0 });
            });
        };

        const reverseGeocode = async (lat, lon) => {
            const wait = GEOCODE_MIN_INTERVAL - (Date.now() - lastGeocodeAt);
            if (wait > 0) await new Promise((r) => setTimeout(r, wait));
            lastGeocodeAt = Date.now();
            // User-Agent は fetch では送れない禁止ヘッダーなので指定しない。
            // 言語は accept-language クエリで渡す
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ja`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('API Error');
            return await res.json();
        };

        const formatAddress = (data) => {
            const a = data.address || {};
            const cityStart = a.city || a.town || a.village || a.municipality || a.county || '';
            // road / house_number / building は入れない。日本の OSM には地番がほとんど無く、
            // Nominatim は最寄りの道路や建物にスナップするため、
            // 実際の所在地とは違う名前(県道名・橋の名前など)が混ざる
            const areaParts = [
                a.city_district,
                a.ward,
                a.suburb,
                a.quarter,
                a.neighbourhood,
                a.block,
                a.residential,
                a.hamlet
            ].filter(Boolean);
            // 階層どうしが重なることがある(neighbourhood='平池町' と quarter='平池町四丁目' など)。
            // 完全一致だけでなく、包含関係でも重複を潰す
            const merged = [];
            [cityStart, ...areaParts].filter(Boolean).forEach((part) => {
                if (merged.some((m) => m.includes(part))) return;
                while (merged.length && part.startsWith(merged[merged.length - 1])) merged.pop();
                merged.push(part);
            });
            const formatted = merged.join('');
            return formatted || data.display_name?.replace(/^.*?[都道府県]\s*/, '') || '住所不明';
        };

        const getCurrentLocation = async (onProgress) => {
            if (!navigator.geolocation) {
                return { address: '位置情報非対応', lat: null, lon: null, accuracy: null };
            }
            const pos = await acquirePosition(onProgress);
            if (!pos) {
                return { address: '位置情報取得失敗', lat: null, lon: null, accuracy: null };
            }
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            const accuracy = Math.round(pos.coords.accuracy);
            try {
                const data = await reverseGeocode(lat, lon);
                return { address: formatAddress(data), lat, lon, accuracy };
            } catch (e) {
                // 座標は取れているので捨てない。住所だけ手で直してもらう
                return { address: '住所取得エラー', lat, lon, accuracy };
            }
        };

        // --- 距離の検査 ---
        // 手元の実データ(110日 / 311区間)から決めた閾値。
        // 区間は最大 108km の次が 512km、1日は最大 98km の次が 1002km と、
        // 現実的な値と打ち間違いの間がはっきり空いている
        const MAX_LEG_KM = 200;
        const MAX_DAY_KM = 300;

        // 直前の到着メーター。無ければ開始メーター
        const lastArrivalKm = () => {
            const arr = logs.value.filter(l => l.type === 'arrival' && l.mileage);
            return arr.length ? Number(arr[arr.length - 1].mileage) : Number(startMileage.value);
        };

        const mileageIssue = (km) => {
            if (!Number.isFinite(km) || km <= 0) return 'メーターが入力されていません。';
            const prev = lastArrivalKm();
            if (km < prev) return `メーターが前回(${prev}km)より小さくなっています。`;
            const leg = km - prev;
            if (leg > MAX_LEG_KM) return `前回から ${leg}km 走ったことになります。桁を間違えていませんか。`;
            return '';
        };

        // 保存済みの記録を検査して、履歴一覧に印を出す
        const historyIssue = (item) => {
            if (!item) return '';
            const total = Number(item.totalDistance);
            if (Number.isFinite(total)) {
                if (total < 0) return 'メーターが戻っています';
                if (total > MAX_DAY_KM) return `走行 ${total}km`;
            }
            let prev = Number(item.startMileage) || 0;
            const list = item.logs || [];
            for (let i = 0; i < list.length; i++) {
                const l = list[i];
                if (l.type !== 'arrival' || !l.mileage) continue;
                const km = Number(l.mileage);
                if (km < prev) return 'メーターが戻っています';
                if (km - prev > MAX_LEG_KM) return `区間 ${km - prev}km`;
                prev = km;
            }
            return '';
        };

        // --- Core Actions ---
        const startWork = () => {
            const km = Number(inputBuffer.value);
            if (!inputBuffer.value || !Number.isFinite(km) || km <= 0) {
                alert('開始メーターを入力してください。');
                return;
            }
            startMileage.value = km;
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
            const loc = await getCurrentLocation((acc) => {
                loadingText.value = `位置情報を取得中... 精度 ±${Math.round(acc)}m`;
            });
            tempTime.value = time;
            tempAddress.value = loc.address;
            tempLat.value = loc.lat;
            tempLon.value = loc.lon;
            tempAccuracy.value = loc.accuracy;
            tempTollFee.value = '';
            tempParkingFee.value = '';
            refreshCandidates();   // 到着した時点で近くの配送先を出しておく
            loading.value = false;
            screen.value = 'mileage_check';
            inputBuffer.value = '';
        };

        const confirmArrival = () => {
            const km = Number(inputBuffer.value);
            const issue = mileageIssue(km);
            if (issue && !confirm(issue + '\nこのまま記録しますか？')) return;

            saveStateForUndo();
            const log = {
                type: 'arrival',
                time: tempTime.value,
                address: tempAddress.value,
                mileage: km
            };
            // 立替は入力があったときだけ持たせる(format-spec §1)
            const toll = Number(tempTollFee.value);
            const park = Number(tempParkingFee.value);
            if (Number.isFinite(toll) && toll > 0) log.tollFee = toll;
            if (Number.isFinite(park) && park > 0) log.parkingFee = park;
            logs.value.push(log);
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
            refreshCandidates();
            // 一度行った場所なら、押さなくても候補が出るようにする
            showCandidateList.value = filteredCandidates.value.length > 0;
            screen.value = 'departure_check';
        };

        // 探す半径。固定 150m だと、測位が粗い日は登録済みの場所が1件も入らず
        // 候補が出なかった。GPS の誤差ぶんを足して広げる
        const candidateRadius = () => {
            const acc = Number(tempAccuracy.value) || 0;
            return Math.min(400, Math.max(150, acc + 100));
        };

        const refreshCandidates = () => {
            if (!tempLat.value || !tempLon.value) { filteredCandidates.value = []; return; }
            const radius = candidateRadius();
            const seen = new Set();
            const list = [];
            savedLocations.value
                .map((loc) => ({ loc, d: getDistance(tempLat.value, tempLon.value, loc.lat, loc.lon) }))
                .filter((x) => x.d < radius)
                .sort((a, b) => a.d - b.d)          // 近い順
                .forEach(({ loc }) => {
                    if (seen.has(loc.name)) return;
                    seen.add(loc.name);
                    list.push(loc);
                });
            filteredCandidates.value = list;
        };

        const toggleCandidateList = () => {
            showCandidateList.value = !showCandidateList.value;
            if (showCandidateList.value) refreshCandidates();
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
            refreshCandidates();
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
            isNewPastEntry.value = false;
            editingIndex.value = -1;
            showSettings.value = false;
            historyData.value = null;
            if (screen.value !== 'start') screen.value = 'start';
        };

        const saveAndReset = () => {
            const total = calculateTotalDistance.value;
            if (total > MAX_DAY_KM &&
                !confirm(`本日の走行が ${total}km になっています。\nメーターの桁を間違えていませんか。\n\nこのまま完了しますか？`)) return;
            if(!confirm('本日の業務を完了しますか？')) return;
            const todayStr = formatDateStr(new Date());
            historyList.value.unshift({
                dateStr: todayStr,
                startMileage: startMileage.value,
                startTime: startTime.value,
                vehicleNo: vehicleNumber.value,
                daily: normalizeDaily(daily.value),
                logs: logs.value,
                totalDistance: calculateTotalDistance.value
            });
            updateHistoryStorage();
            localStorage.removeItem('nippoData_pro_v3');

            // リセット。夏季手当だけは翌日も同じ額が続くので持ち越す
            const keepKaki = daily.value.kaki;
            daily.value = emptyDaily();
            daily.value.kaki = keepKaki;
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
                clampHistoryPage();
            }
        };
        const clearAllHistory = () => {
            if(!confirm('【警告】日報の履歴データを全て削除しますか？')) return;
            historyList.value = [];
            updateHistoryStorage();
            currentHistoryPage.value = 0;
            showSettings.value = false;
        };
        const clearLocations = () => {
            if(!confirm('【警告】学習した配送先リストを全て削除しますか？')) return;
            savedLocations.value = [];
            saveLocations();
            alert('配送先履歴をリセットしました。');
            showSettings.value = false;
        };

        // --- LINE へ送る日報 ---
        // これまでは PDF に変換してから送っていた。読む側は本文のまま読めたほうが速く、
        // 転記も引用もできるのでテキストで組み立てる。
        // (copyToClipboard の KEY::VALUE 形式は機械向けで、人が読む形ではない)
        const circled = (n) => (n >= 1 && n <= 20 ? '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'[n - 1] : `(${n})`);
        const yen = (v) => Number(v).toLocaleString('ja-JP') + '円';

        const buildReportText = () => {
            const hist = viewingHistoryMode.value;
            const src = hist ? (historyData.value || {}) : null;
            const targetLogs = hist ? (src.logs || []) : logs.value;
            const startKm = hist ? src.startMileage : startMileage.value;
            const startAt = hist ? src.startTime : startTime.value;
            const date = hist ? src.dateStr : formatDateStr(new Date());
            const car = (hist ? (src.vehicleNo || vehicleNumber.value) : vehicleNumber.value) || '';

            const groups = createGroups(targetLogs);
            const arrivals = targetLogs.filter((l) => l.type === 'arrival' && l.mileage);
            const endKm = arrivals.length ? arrivals[arrivals.length - 1].mileage : null;
            const endAt = targetLogs.length ? targetLogs[targetLogs.length - 1].time : '';
            const distance = (endKm !== null && startKm !== undefined && startKm !== null)
                ? Number(endKm) - Number(startKm) : null;

            const out = [];
            out.push(`■ ${date} 配送日報`);
            if (car) out.push(`車両 ${car}`);
            if (startAt || endAt) out.push(`${startAt || '--:--'} 〜 ${endAt || '--:--'}`);
            if (distance !== null) {
                out.push(`走行 ${distance.toLocaleString('ja-JP')}km（${Number(startKm).toLocaleString('ja-JP')} → ${Number(endKm).toLocaleString('ja-JP')}）`);
            }

            let toll = 0;
            let park = 0;
            groups.forEach((g, i) => {
                const a = g.arrival || {};
                const d = g.departure || {};
                out.push('');
                out.push(`${circled(i + 1)} ${d.destination || '(配送先なし)'}`);
                const times = [];
                if (a.time) times.push(`${a.time}着`);
                if (d.time) times.push(`${d.time}発`);
                const head = times.join(' → ');
                out.push(`　${head}${head && d.payment ? ' ／ ' : ''}${d.payment || ''}`.replace(/\s+$/, ''));
                if (a.address) out.push(`　${a.address}`);
                const fees = [];
                if (a.tollFee > 0) { toll += Number(a.tollFee); fees.push(`高速 ${yen(a.tollFee)}`); }
                if (a.parkingFee > 0) { park += Number(a.parkingFee); fees.push(`駐車 ${yen(a.parkingFee)}`); }
                if (fees.length) out.push(`　${fees.join(' ／ ')}`);
                if (d.remarks) out.push(`　備考 ${d.remarks}`);
            });

            out.push('');
            const tail = [`合計 ${groups.length}件`];
            if (toll + park > 0) tail.push(`立替 ${yen(toll + park)}`);
            out.push(tail.join(' ／ '));
            return out.join('\n');
        };

        // LINE を直接開き、送信先選択画面まで1タップで飛ぶ。
        // hamanippo の「LINEで直接送る」(apps/hamanippo/app.js:1376-1379) と同じ手。
        // navigator.share を先に呼ぶと OS の共有シートが挟まって2段階になるので使わない。
        // このURLで渡せるのは**テキストだけ**（LINE URLスキームの仕様）。
        // ファイルを添付するなら共有シートを通すしかない → shareNippoPdf
        const shareReport = () => {
            const text = buildReportText();
            window.location.href = 'https://line.me/R/share?text=' + encodeURIComponent(text);
        };

        const copyReportText = () => {
            const text = buildReportText();
            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                alert('この環境ではコピーできません。');
                return;
            }
            navigator.clipboard.writeText(text).then(() => {
                showTextToast.value = true;
                setTimeout(() => showTextToast.value = false, 2000);
            }).catch(() => alert('コピーできませんでした。'));
        };

        // --- 日報 PDF（format-spec §4.7） ---
        // 様式は 自動記帳キット/fmt.py build_nippo と同じ。組み立ては nippo-pdf.js
        const buildNippoData = () => {
            const hist = viewingHistoryMode.value;
            const src = hist ? (historyData.value || {}) : null;
            const targetLogs = hist ? (src.logs || []) : logs.value;
            const startKm = hist ? src.startMileage : startMileage.value;
            const arrivals = targetLogs.filter((l) => l.type === 'arrival' && l.mileage);
            let endKm = arrivals.length ? Number(arrivals[arrivals.length - 1].mileage) : null;
            // 到着メーターが1件も無い日の代替。01_nippo.py の C5 と同じ決め方
            if (endKm === null && hist && Number.isFinite(Number(src.totalDistance))) {
                endKm = Number(startKm) + Number(src.totalDistance);
            }
            let toll = 0, park = 0;
            targetLogs.forEach((l) => {
                toll += Number(l.tollFee) || 0;
                park += Number(l.parkingFee) || 0;
            });
            return {
                client: '永田商店',
                dateStr: hist ? src.dateStr : formatDateStr(new Date()),
                driverName: driverName.value,
                vehicleNo: (hist ? (src.vehicleNo || vehicleNumber.value) : vehicleNumber.value) || '',
                startMileage: startKm,
                endMileage: endKm,
                startTime: hist ? src.startTime : startTime.value,
                endTime: targetLogs.length ? targetLogs[targetLogs.length - 1].time : '',
                cases: createGroups(targetLogs).map((g) => {
                    const a = g.arrival || {}, d = g.departure || {};
                    return {
                        address: a.address || '', destination: d.destination || '',
                        arrTime: a.time || '', depTime: d.time || '',
                        payment: d.payment || '', mileage: a.mileage || '',
                        remarks: d.remarks || ''
                    };
                }),
                daily: activeDaily.value,
                toll: toll || null,
                park: park || null
            };
        };

        // 直前に組んだ PDF。同じ内容なら作り直さずに共有する。
        // iOS は share() をユーザー操作の直後に呼ぶ必要があり、生成に時間がかかると
        // 権限切れで弾かれる。2回目のタップはここから即座に共有できる
        let pdfCache = null;
        const sharingPdf = ref(false);

        const shareNippoPdf = async () => {
            if (sharingPdf.value) return;
            const data = buildNippoData();

            if (data.cases.length > NippoForm.MAX_CASES &&
                !confirm(`案件が ${data.cases.length} 件あります。\n日報は ${NippoForm.MAX_CASES} 件までなので、`
                         + `${NippoForm.MAX_CASES + 1} 件目以降は載りません。\n\nこのまま作りますか？`)) return;
            if (!dailyFilled.value &&
                !confirm('当日実績（①〜⑤）が未入力です。\n回収料金と作業料金が 0 のままになります。\n\nこのまま作りますか？')) return;

            const key = JSON.stringify(data);
            if (pdfCache && pdfCache.key === key) {
                await sharePdfFile(pdfCache.blob, pdfCache.name);
                return;
            }

            sharingPdf.value = true;
            loading.value = true;
            loadingText.value = '日報PDFを作成中...';
            let out;
            try {
                out = await NippoForm.buildPdf(data);
                pdfCache = { key, blob: out.blob, name: out.name };
            } catch (e) {
                console.error(e);
                alert('日報PDFを作れませんでした。\n' + ((e && e.message) || ''));
                return;
            } finally {
                loading.value = false;
                sharingPdf.value = false;
            }
            await sharePdfFile(out.blob, out.name);
        };

        const sharePdfFile = async (blob, name) => {
            const file = new File([blob], name, { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try {
                    await navigator.share({ files: [file], title: name });
                    return;
                } catch (e) {
                    if (e && e.name === 'AbortError') return;       // ユーザーが閉じただけ
                    if (e && e.name === 'NotAllowedError') {
                        alert('PDFはできています。\nもう一度「日報PDFをLINEで送る」を押してください。');
                        return;
                    }
                    console.error(e);
                }
            }
            downloadBlob(blob, name);
            alert('この端末では共有シートを開けないため、PDFを保存しました。\nファイルアプリからLINEで送ってください。');
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
            data.push('FORMAT::NAGATASAN-EXPORT-1');
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

            if (!navigator.clipboard || !navigator.clipboard.writeText) {
                alert('この環境ではコピーできません。');
                return;
            }
            navigator.clipboard.writeText(data.join('\n')).then(() => {
                showCopyToast.value = true;
                setTimeout(() => showCopyToast.value = false, 2000);
            }).catch(() => {
                alert('コピーできませんでした。');
            });
        };

        // 【修正 #3】ディープコピーで履歴を閲覧（元データを直接変更しない）
        const viewHistory = (item) => {
            viewingHistoryMode.value = true;
            isNewPastEntry.value = false;
            // 保存時の書き戻し先。編集で日付や時刻が変わっても見失わない
            editingIndex.value = historyList.value.indexOf(item);
            historyData.value = JSON.parse(JSON.stringify(item));
            fillDaily(historyData.value);
            screen.value = 'summary';
        };

        // 記録し忘れた過去日を後から入力する。当日の進行中データには触らない
        const startPastEntry = () => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            historyData.value = {
                dateStr: formatDateStr(d),
                vehicleNo: vehicleNumber.value || '',
                startMileage: 0,
                startTime: '',
                daily: emptyDaily(),
                logs: [],
                totalDistance: 0
            };
            viewingHistoryMode.value = true;
            isNewPastEntry.value = true;
            editingIndex.value = -1;
            screen.value = 'summary';
            enterEditMode();
        };

        // Computed Stats
        const activeLogs = computed(() => viewingHistoryMode.value ? historyData.value?.logs || [] : logs.value);
        const activeStart = computed(() => viewingHistoryMode.value ? historyData.value?.startMileage || 0 : startMileage.value);
        
        const getStatusText = computed(() => {
            if (lastAction.value === 'none') return '業務開始前';
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

        // dashboard に出す当日の記録。走行中に知りたいのは
        // 「何件終わったか / 何km走ったか / 直前はどこか」
        const todaySummary = computed(() => {
            const groups = createGroups(logs.value);
            const done = groups.filter((g) => g.departure).pop();
            let fee = 0;
            logs.value.forEach((l) => {
                fee += (Number(l.tollFee) || 0) + (Number(l.parkingFee) || 0);
            });
            return {
                done: logs.value.filter((l) => l.type === 'departure').length,
                distance: calculateTotalDistance.value,
                fee,
                lastName: done && done.departure ? done.departure.destination : '',
                lastTime: done && done.departure ? done.departure.time : ''
            };
        });

        const paginatedHistory = computed(() => {
            const start = currentHistoryPage.value * 5;
            return historyList.value.slice(start, start + 5);
        });
        const totalHistoryPages = computed(() => Math.max(1, Math.ceil(historyList.value.length / 5)));
        // 件数が減ったときに、存在しないページへ取り残されないようにする
        const clampHistoryPage = () => {
            const max = totalHistoryPages.value - 1;
            if (currentHistoryPage.value > max) currentHistoryPage.value = max;
        };

        return {
            screen, inputBuffer, loading, loadingText, lastAction, startMileage,
            historyList, viewingHistoryMode, historyData, showCopyToast, showTextToast, showSettings,
            vehicleNumber, vehicleNumberHistory, vehicleNumberInput, vehiclePick, pickVehicleNumber,
            canForgetVehicleNumber, forgetVehicleNumber,
            moveVehicleCaretToEnd, saveVehicleNumber, selectVehicleNumber, removeVehicleNumberFromHistory, startTime, undoStack, undo, handleHeaderBack,
            
            // Keypad
            appendDigit, removeDigit, getDisplayDigit,

            // Modal & Data
            // 【修正 #6】tempLocation エイリアスを廃止し tempAddress に統一
            tempAddress, tempTime, tempAccuracy, tempTollFee, tempParkingFee,
            historyIssue,
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
            todaySummary,
            buildReportText, shareReport, copyReportText,

            // 当日実績と日報PDF
            DAILY_FIELDS, activeDaily, persistDaily, dailyFilled, nippoFare, tatekaeTotal,
            driverName, saveDriverName, shareNippoPdf, sharingPdf,

            // Edit Mode
            isEditing, editBuffer, enterEditMode, saveEditMode, cancelEditMode, removeGroupFromBuffer,
            isNewPastEntry, addGroupToBuffer, startPastEntry, editDateInput,
            refreshCandidates,
            getEditLastMileage, calculateEditTotalDistance
        };
    }
}).mount('#app');
