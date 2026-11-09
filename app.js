const { createApp, ref, onMounted, computed, watch, nextTick } = Vue;

createApp({
    setup() {
        // --- State ---
        const screen = ref('start'); 
        // SM-1 の5状態。localStorage から復元する値をこれで検証する
        const SCREENS = ['start', 'dashboard', 'mileage_check', 'departure_check', 'summary'];
        const INPUT_SCREENS = ['mileage_check', 'departure_check'];
        const inputBuffer = ref(''); 
        const lastAction = ref('none'); 
        const startMileage = ref(0);
        const logs = ref([]);
        const vehicleNumber = ref('');
        const vehicleNumberHistory = ref([]);
        const vehicleNumberInput = ref(null);
        const vehiclePick = ref('');   // 履歴プルダウンの選択値。選ぶたびに空へ戻す
        const startTime = ref('');
        // 業務開始を押した日（format-spec §1 の dateStr）。業務完了の日を使うと、
        // 日をまたいで完了した運行が翌日の日付で記録される
        const dateStr = ref('');
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
            // sticky = 前回値を引き継ぐ欄。日ごとに入れるものではないので、
            // 「当日実績が未入力か」の判定からは外す（これを数えると、
            // 起動時に必ず 500 が入る夏季手当のせいで警告が一度も出なくなる）
            { key: 'kaki',     label: '⑤夏季手当', unit: '円', sticky: true }
        ];
        const DAILY_INPUT_KEYS = DAILY_FIELDS.filter((f) => !f.sticky).map((f) => f.key);
        // ①〜④はその仕事が無い日がほとんどなので、畳んでおき必要な日だけ開く
        const DAILY_STICKY_FIELDS = DAILY_FIELDS.filter((f) => f.sticky);
        const DAILY_EXTRA_FIELDS = DAILY_FIELDS.filter((f) => !f.sticky);
        const emptyDaily = () => {
            const d = {};
            DAILY_FIELDS.forEach((f) => { d[f.key] = ''; });
            return d;
        };
        const daily = ref(emptyDaily());

        // 金額の手直し（日報の E21〜E24 / C29〜C34 / format-spec §1 §3.1）。
        // 上書きの単位はセル1つで、空欄なら自動計算のまま。
        // 入力欄は正の数で受け、▲割引だけ符号を反転して持つ
        // （テンキーに「−」が無い端末があるため）。
        const FARE_FIELDS = [
            { key: 'e21', label: '②配達数の金額', section: 'jisseki' },
            { key: 'e22', label: '③追加配達の金額', section: 'jisseki' },
            { key: 'e23', label: '④作業・待機の金額', section: 'jisseki' },
            { key: 'e24', label: '⑤夏季手当の金額', section: 'jisseki' },
            { key: 'kihon', label: '基本運賃', section: 'unchin' },
            { key: 'kyori', label: '距離料金', section: 'unchin' },
            { key: 'kaisyu', label: '回収料金', section: 'unchin' },
            { key: 'sagyo', label: '作業料金(②〜⑤)', section: 'unchin' },
            { key: 'waribiki', label: '▲割引(10%)', section: 'unchin',
              negative: true, hint: '正の数で' },
            { key: 'total', label: '合計', section: 'unchin' }
        ];
        const FARE_SECTIONS = [
            { title: '当日実績の金額', fields: FARE_FIELDS.filter((f) => f.section === 'jisseki') },
            { title: '運賃計算', fields: FARE_FIELDS.filter((f) => f.section === 'unchin') }
        ];
        const emptyFareOverride = () => {
            const d = {};
            FARE_FIELDS.forEach((f) => { d[f.key] = ''; });
            return d;
        };
        const fareOverride = ref(emptyFareOverride());
        // ボタンを押したときだけ入力欄を出す。毎回は出さない
        const showFareEdit = ref(false);
        const showDailyExtra = ref(false);

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
        const tempRemarks = ref('');
        const paymentOptions = ['現金', 'カード', '請求書', 'web', '該当なし'];

        // 配送先名 → そこで最後に使った支払。履歴（古い順）、当日の記録の順に入れ直すので、
        // Map の並びは行った順（末尾が直近）になる
        const destinationHistory = computed(() => {
            const map = new Map();
            const visit = (list) => (list || []).forEach((l) => {
                const name = l.type === 'departure' ? (l.destination || '').trim() : '';
                if (!name) return;
                map.delete(name);
                map.set(name, l.payment);
            });
            for (let i = historyList.value.length - 1; i >= 0; i--) visit(historyList.value[i].logs);
            visit(logs.value);
            return map;
        });

        // 押して選んだ支払。選んでいなければ、その配送先で前回使った支払（無ければ現金）
        const paymentChoice = ref('');
        const tempPaymentMethod = computed(() => {
            if (paymentChoice.value) return paymentChoice.value;
            const last = destinationHistory.value.get(tempDestinationName.value.trim());
            return paymentOptions.includes(last) ? last : '現金';
        });
        
        // Intelligent History Feature
        const showCandidateList = ref(false);

        // GPS Intelligence
        const tempLat = ref(null);
        const tempLon = ref(null);
        const tempAccuracy = ref(null);
        const savedLocations = ref([]);

        // --- 開始時刻 ---
        // 開始時刻が「アプリを開いた時刻」で固まっていた。原因は2つある。
        //   1. 業務開始の取り消し(handleHeaderBack)は screen:'start' のまま saveData() するので、
        //      古い startTime が保存に残り、次に開いたとき復元されていた
        //   2. 時刻を入れるのが onMounted の中だけだった。onMounted はページの読み込み1回につき
        //      1回しか走らないので、再読込されずに再開した場合（ホーム画面のPWA）は固まる
        // 2 を「再開イベントで直す」だけにすると、イベントが飛ばない端末で古い時刻が記録される。
        // そこで記録する側を直す = startWork() が押された瞬間に時計を読み直す。
        // イベントと定期更新は画面の表示を合わせるためだけのもので、正しさはそれに依存しない。
        //
        // 業務開始後の startTime は日報に載る実測値なので触らない。
        // 手で直した時刻も上書きしない（自動で入れた最後の値と食い違えば人が直したと見なす）。
        const nowHm = () => new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        const autoStartTime = ref('');
        const setStartTimeNow = () => {
            autoStartTime.value = nowHm();
            startTime.value = autoStartTime.value;
        };
        // 自動で入れた値のままか（違えば人が手で直している）
        const isAutoStartTime = () => startTime.value === autoStartTime.value;
        const refreshStartTime = () => {
            if (screen.value !== 'start' || startMileage.value > 0) return;
            if (!isAutoStartTime()) return;
            // 時刻欄を触っている最中に値を差し替えない（iOS のピッカーが飛ぶ）
            const el = document.activeElement;
            if (el && el.type === 'time') return;
            setStartTimeNow();
        };

        // --- Initialization ---
        onMounted(() => {
            document.getElementById('app').style.display = ''; 
            setStartTimeNow();

            // Load Data
            const savedData = localStorage.getItem('nippoData_pro_v3');
            if (savedData) {
                try {
                    const parsed = JSON.parse(savedData);
                    screen.value = SCREENS.includes(parsed.screen) ? parsed.screen : 'start';
                    startMileage.value = parsed.startMileage || 0;
                    logs.value = parsed.logs || [];
                    lastAction.value = parsed.lastAction || 'none';
                    // 業務開始後の時刻だけ戻す。start 画面のまま保存された古い時刻を戻すと、
                    // 次に開いたときも「前回開いた時刻」が居座る
                    if (parsed.startTime && screen.value !== 'start') startTime.value = parsed.startTime;
                    if (parsed.dateStr) dateStr.value = parsed.dateStr;
                    // 到着した地点。完了のときに配送先を学習し、近くの候補を出すのに使う。
                    // 戻さないと、到着から完了までの間に再読込されたとき黙って失われる
                    if (parsed.arrivalPos) {
                        tempLat.value = parsed.arrivalPos.lat;
                        tempLon.value = parsed.arrivalPos.lon;
                        tempAccuracy.value = parsed.arrivalPos.accuracy;
                    }
                    if (parsed.undoStack) undoStack.value = parsed.undoStack;
                    if (parsed.daily) daily.value = Object.assign(emptyDaily(), parsed.daily);
                    if (parsed.fareOverride) {
                        fareOverride.value = Object.assign(emptyFareOverride(), parsed.fareOverride);
                    }
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

            // 表示を現在時刻に合わせ続ける。非表示の間はタイマーが間引かれる（端末によっては
            // 止まる）ので、再表示された瞬間にも読み直す。記録される開始時刻は startWork() が
            // その場で時計を読むので、この2つが動かなくても古くならない
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') refreshStartTime();
            });
            setInterval(refreshStartTime, 30000);
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
        // 当日の運行の日付。旧版で開始した作業中データは日付を持たないので、今日として扱う
        const runDateStr = () => dateStr.value || formatDateStr(new Date());
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
                // 日付を直せるのは履歴レコードだけ。当日の進行中データの日付は
                // 業務開始を押した日で、ここでは編集させない
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
                saved.fareOverride = normalizeFareOverride(historyData.value.fareOverride);
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
                // 押せるボタン（到着／完了）は最後の記録で決まる。編集前のままだと、
                // 到着を消したのに完了が押せて、到着の無い完了行ができる
                lastAction.value = newLogs.length ? newLogs[newLogs.length - 1].type : 'start';
                // 「戻る」は編集前のスナップショットへ戻すので、編集が黙って消える
                undoStack.value = [];
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

        // --- Save & Storage ---
        const saveData = () => {
            const data = {
                // 入力画面は保存しない（SM-1）。開いている間に裏の位置取りが保存しても、
                // 再読込で戻るのは dashboard。入力途中の値は残っていないので、入力画面へは戻せない
                screen: INPUT_SCREENS.includes(screen.value) ? 'dashboard' : screen.value,
                startMileage: startMileage.value,
                logs: logs.value,
                lastAction: lastAction.value,
                startTime: startTime.value,
                dateStr: dateStr.value,
                arrivalPos: { lat: tempLat.value, lon: tempLon.value, accuracy: tempAccuracy.value },
                undoStack: undoStack.value,
                daily: daily.value,
                fareOverride: fareOverride.value
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

        // 毎日入れる欄が1つでも埋まっているか。夏季手当は前回値が必ず入っているので数えない
        const dailyFilled = computed(() => {
            const d = activeDaily.value;
            return DAILY_INPUT_KEYS.some((k) => d[k] !== '' && d[k] !== null && d[k] !== undefined);
        });

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

        // --- 金額の手直し（日報 E21〜E24 / C29〜C34 / format-spec §3.1） ---
        // daily と同じ作りにしてある。当日は fareOverride、履歴を開いているときは
        // historyData.fareOverride を直接編集する。

        const fillFareOverride = (rec) => {
            const src = rec.fareOverride || {};
            const out = emptyFareOverride();
            FARE_FIELDS.forEach((f) => {
                const v = src[f.key];
                if (v === undefined || v === null || v === '') return;
                // 保存してある ▲割引は負の数。入力欄へは正の数で戻す
                out[f.key] = f.negative ? Math.abs(Number(v)) : v;
            });
            rec.fareOverride = out;
        };

        const activeFareOverride = computed(() => {
            if (!viewingHistoryMode.value || !historyData.value) return fareOverride.value;
            return historyData.value.fareOverride || fareOverride.value;
        });

        const normalizeFareOverride = (src) => {
            const out = {};
            FARE_FIELDS.forEach((f) => {
                const raw = src ? src[f.key] : '';
                if (raw === '' || raw === null || raw === undefined) return;
                const v = Number(raw);
                if (Number.isFinite(v)) out[f.key] = f.negative ? -Math.abs(v) : v;
            });
            return Object.keys(out).length ? out : undefined;
        };

        const fareOverrideCount = computed(() => {
            const d = activeFareOverride.value;
            return FARE_FIELDS.filter((f) => d[f.key] !== '' && d[f.key] !== null &&
                                             d[f.key] !== undefined).length;
        });

        const persistFareOverride = () => {
            if (!viewingHistoryMode.value) { saveData(); return; }
            // 履歴を開いているときは、その場で書き戻す（編集モードを通さない）
            if (editingIndex.value !== -1 && historyList.value[editingIndex.value]) {
                historyList.value[editingIndex.value].fareOverride =
                    normalizeFareOverride(activeFareOverride.value);
                updateHistoryStorage();
            }
        };

        const clearFareOverride = () => {
            const t = activeFareOverride.value;
            FARE_FIELDS.forEach((f) => { t[f.key] = ''; });
            persistFareOverride();
        };

        // 確認画面と日報 PDF に出す金額の内訳。手直しした行はその値になる
        const fareView = computed(() => {
            const km = calculateTotalDistance.value;
            const d = activeDaily.value;
            const n = (x) => (x === '' || x === null || x === undefined ? null : Number(x));
            return NippoForm.fareParts(km, n(d.kaisyuKm), n(d.hako), n(d.shoku),
                                       n(d.tsuika), n(d.taiki), n(d.kaki), NippoForm.KIHON,
                                       normalizeFareOverride(activeFareOverride.value) || {});
        });

        // 空欄の欄に薄く出す自動計算値。他の欄の手直しも織り込んだ値になる
        const fareAutoText = (f) => {
            const v = fareView.value[f.key];
            return Math.round(f.negative ? Math.abs(v) : v).toLocaleString('ja-JP');
        };

        // 確認画面に出す当日の運賃。日報の C34 と同じ値になる
        const nippoFare = computed(() => NippoForm.roundHalfEven(fareView.value.total));

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

        // 業務開始前に戻す。業務完了と業務開始の取り消しの両方がここを通る。
        // 取り消しだけ別に書いていたため当日実績と手直しが残り、次の運行の請求に乗っていた
        const resetRun = () => {
            // 夏季手当だけは翌日も同じ額が続くので持ち越す
            const keepKaki = daily.value.kaki;
            daily.value = emptyDaily();
            daily.value.kaki = keepKaki;
            // 手直しはその運行限り。次へは持ち越さない
            fareOverride.value = emptyFareOverride();
            showFareEdit.value = false;
            showDailyExtra.value = false;
            screen.value = 'start';
            startMileage.value = 0;
            logs.value = [];
            undoStack.value = [];
            lastAction.value = 'none';
            inputBuffer.value = '';
            setStartTimeNow();   // 次の開始時刻は今
        };

        const handleHeaderBack = () => {
            if (undoStack.value.length > 0) {
                // 押し間違えると直前の記録が消える。何が消えるかを出して確かめる
                const last = logs.value[logs.value.length - 1];
                const what = last ? `（${last.type === 'arrival' ? '到着' : '完了'} ${last.time}）` : '';
                if (confirm(`直前の記録${what}を取り消しますか？`)) undo();
            } else {
                // 当日分を編集して保存すると取り消しの履歴が空になり、記録があってもここへ来る。
                // 1回の承諾でその日の記録が全部消えるので、消える件数を出す
                const n = logs.value.length;
                const msg = n
                    ? `この運行の記録 ${n} 件をすべて消して、業務開始を取り消しますか？`
                    : '業務開始を取り消してトップ画面に戻りますか？\n（入力内容はリセットされます）';
                if (confirm(msg)) {
                    resetRun();
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
        // 電波の弱い所では、応答も失敗も返らないまま通信が止まる。打ち切らないと
        // 「位置情報を取得中」のまま画面が固まる
        const GEOCODE_TIMEOUT = 8000;

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

        // 国土地理院の逆ジオコーダ。住所は 市区町村 + 町字（例 千代田区千代田）。
        // API は市区町村をコードでしか返さないので、名前は vendor/gsi-muni.json で引く
        // （tools/build-gsi-muni.mjs が作る。キーは先頭の 0 を落としたコード）。
        // 表に無いコードは住所不明にする。町字だけだと日報の B列（市町村）が町名になる
        const reverseGeocode = async (lat, lon) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), GEOCODE_TIMEOUT);
            try {
                const url = `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`;
                const [res, muni] = await Promise.all([
                    fetch(url, { signal: ctrl.signal }),
                    fetch('./vendor/gsi-muni.json', { signal: ctrl.signal }).then((r) => r.json())
                ]);
                if (!res.ok) throw new Error('API Error');
                const r = (await res.json()).results;
                const city = r && muni[String(Number(r.muniCd))];
                if (!city) return '住所不明';
                return r.lv01Nm && r.lv01Nm !== '－' ? city + r.lv01Nm : city;
            } finally {
                clearTimeout(timer);
            }
        };

        // 通信の失敗・打ち切り。住所より先に記録した到着にも、取れるまでこれを入れておく
        const ADDRESS_LOST = '住所取得エラー';

        // 位置が決まった時点で onPosition を呼び、住所（format-spec §1 の値のどれか）を返す
        const locate = async (onProgress, onPosition) => {
            if (!navigator.geolocation) return '位置情報非対応';
            const pos = await acquirePosition(onProgress);
            if (!pos) return '位置情報取得失敗';
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            onPosition(lat, lon, Math.round(pos.coords.accuracy));
            try {
                return await reverseGeocode(lat, lon);
            } catch (e) {
                // 座標は取れているので捨てない。住所だけ手で直してもらう
                return ADDRESS_LOST;
            }
        };

        // --- 到着の位置取り（SM-1 dashboard → mileage_check） ---
        // 到着を押したら位置を待たずに入力画面を出し、位置と住所は裏で取る。
        // 位置取りは到着1回につき1つ（job）。結果を入れてよい先は2つだけ:
        //   入力画面の欄 … job が最新（currentJob）で、まだ記録していないとき
        //   到着記録     … job が記録した到着（job.log）が logs に残っているとき。
        //                  同じオブジェクトかで探すので、取り消された記録や別の到着には入らない
        // 住所より先に記録したら、記録には ADDRESS_LOST を入れておく。job は保存しないので、
        // 取得中に再読込されるとその値のまま残る（途中の値を保存データに残さない）
        let currentJob = null;
        const locating = ref(false);        // 最新の job が住所を取り終えていない
        const addressWaits = ref(0);        // 記録済みで住所を待っている到着の数

        const startLocating = () => {
            const job = { log: null };
            currentJob = job;
            locating.value = true;
            tempAddress.value = '';
            tempLat.value = null;
            tempLon.value = null;
            tempAccuracy.value = null;
            locate(
                (acc) => { if (job === currentJob) tempAccuracy.value = Math.round(acc); },
                (lat, lon, accuracy) => {
                    if (job !== currentJob) return;
                    tempLat.value = lat;
                    tempLon.value = lon;
                    tempAccuracy.value = accuracy;
                    // 記録済みなら到着地点を保存する。完了で配送先を学習するのに使う
                    if (job.log) saveData();
                }
            ).then((address) => {
                if (job === currentJob) locating.value = false;
                if (job.log) {
                    addressWaits.value--;
                    const i = logs.value.indexOf(job.log);
                    if (i === -1) return;
                    logs.value[i].address = address;
                    saveData();
                } else if (job === currentJob && screen.value === 'mileage_check' && !tempAddress.value) {
                    tempAddress.value = address;   // 手で入れた住所は上書きしない
                }
            });
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

        // --- メーターの入力 ---
        // 前回の値（meterBase）を灰色で出しておき、押した数字はその下の桁を置き換える。
        // 前回 123456 で 7・8 と押せば 123478。変わった桁から下だけ押せばよい。
        // 決定には1桁以上押す必要がある（前回の値のまま記録しない）
        const METER_DIGITS = 6;

        // その運行の最後のメーター。到着が無ければ開始 + 走行（01_nippo.py の C5 と同じ決め方）
        const runEndKm = (item) => {
            const arr = (item.logs || []).filter((l) => l.type === 'arrival' && Number(l.mileage) > 0);
            if (arr.length) return Number(arr[arr.length - 1].mileage);
            const start = Number(item.startMileage) || 0;
            return start > 0 ? start + (Number(item.totalDistance) || 0) : null;
        };

        const meterBase = computed(() => {
            if (screen.value === 'mileage_check') return lastArrivalKm() || null;
            if (screen.value !== 'start') return null;
            // 業務開始は、同じ車番で前回走った運行の最後（履歴は新しい順）
            const prev = historyList.value.find((item) => (item.vehicleNo || '') === vehicleNumber.value);
            return prev ? runEndKm(prev) : null;
        });

        const meterText = computed(() => {
            const typed = inputBuffer.value;
            const base = meterBase.value ? String(meterBase.value) : '';
            if (typed.length >= base.length) return typed;
            return base.slice(0, base.length - typed.length) + typed;
        });
        const meterValue = computed(() => (inputBuffer.value ? Number(meterText.value) : NaN));

        // 6つの枠に右詰めで出す。typed = 押した桁（それ以外は前回の値）
        const meterDigits = computed(() => {
            const text = meterText.value.slice(-METER_DIGITS).padStart(METER_DIGITS, ' ');
            const typed = inputBuffer.value.length;
            return [...text].map((d, i) => ({ d: d.trim(), typed: i >= METER_DIGITS - typed }));
        });

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
            const km = meterValue.value;
            if (!inputBuffer.value || !Number.isFinite(km) || km <= 0) {
                alert('開始メーターを入力してください。');
                return;
            }
            // 押した瞬間の時刻を記録する。画面の更新が届いていなくても（再開直後など）
            // 古い時刻が日報に載ることはない。手で直してある時刻はそのまま使う
            if (isAutoStartTime()) setStartTimeNow();
            dateStr.value = formatDateStr(new Date());
            startMileage.value = km;
            logs.value = [];
            undoStack.value = [];
            inputBuffer.value = '';
            lastAction.value = 'start';
            screen.value = 'dashboard';
            addVehicleNumberToHistory(vehicleNumber.value);
            saveData();
        };

        const handleArrival = () => {
            tempTime.value = nowHm();   // 押した時刻
            // 配送先と支払は案件ごと。到着画面の「近く」で選んだら、完了画面にそのまま出す
            tempDestinationName.value = '';
            paymentChoice.value = '';
            tempTollFee.value = '';
            tempParkingFee.value = '';
            inputBuffer.value = '';
            screen.value = 'mileage_check';
            startLocating();
        };

        const confirmArrival = () => {
            const km = meterValue.value;
            const issue = mileageIssue(km);
            if (issue && !confirm(issue + '\nこのまま記録しますか？')) return;

            saveStateForUndo();
            const log = {
                type: 'arrival',
                time: tempTime.value,
                address: tempAddress.value,
                mileage: km
            };
            if (locating.value && !log.address) {
                log.address = ADDRESS_LOST;
                currentJob.log = log;
                addressWaits.value++;
            }
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
            if (screen.value === 'mileage_check') {
                currentJob = null;   // 記録しなかった到着の位置取りは捨てる
                locating.value = false;
            }
            screen.value = 'dashboard';
            inputBuffer.value = '';
            showCandidateList.value = false;
        };

        // --- Departure & History Logic ---
        const handleDeparture = () => {
            tempDepartureTime.value = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            tempRemarks.value = '';
            // 候補があれば押さなくても出す（到着画面で選んであれば出さない）
            const c = destinationCandidates.value;
            showCandidateList.value = !tempDestinationName.value && c.near.length + c.recent.length > 0;
            screen.value = 'departure_check';
        };

        // 探す半径。固定 150m だと、測位が粗い日は登録済みの場所が1件も入らず
        // 候補が出なかった。GPS の誤差ぶんを足して広げる
        const candidateRadius = () => {
            const acc = Number(tempAccuracy.value) || 0;
            return Math.min(400, Math.max(150, acc + 100));
        };

        // 到着地点の近くで学習した配送先。近い順、同じ名前は1つ
        const nearbyLocations = computed(() => {
            if (!tempLat.value || !tempLon.value) return [];
            const radius = candidateRadius();
            const seen = new Set();
            return savedLocations.value
                .map((loc) => ({ loc, d: getDistance(tempLat.value, tempLon.value, loc.lat, loc.lon) }))
                .filter((x) => x.d < radius)
                .sort((a, b) => a.d - b.d)
                .map((x) => x.loc)
                .filter((loc) => {
                    if (seen.has(loc.name)) return false;
                    seen.add(loc.name);
                    return true;
                });
        });

        // 完了画面の候補。近くの配送先と、最近行った配送先（新しい順・近くと重なる名前は除く）。
        // 位置が取れない日や初めての場所でも、最近の配送先から選べる。
        // 配送先名の欄に入れた文字で絞る（全角半角・大文字小文字は区別しない）
        const RECENT_LIMIT = 20;
        const fold = (s) => String(s || '').normalize('NFKC').toLowerCase();
        const destinationCandidates = computed(() => {
            const q = fold(tempDestinationName.value.trim());
            const hit = (name) => fold(name).includes(q);
            const nearNames = new Set(nearbyLocations.value.map((loc) => loc.name));
            return {
                near: nearbyLocations.value.filter((loc) => hit(loc.name)),
                recent: [...destinationHistory.value.keys()].reverse()
                    .filter((name) => !nearNames.has(name) && hit(name))
                    .slice(0, RECENT_LIMIT)
            };
        });

        const toggleCandidateList = () => {
            showCandidateList.value = !showCandidateList.value;
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
            showFareEdit.value = false;
            showDailyExtra.value = false;
            historyData.value = null;
            if (screen.value !== 'start') screen.value = 'start';
        };

        const saveAndReset = () => {
            const total = calculateTotalDistance.value;
            if (total > MAX_DAY_KM &&
                !confirm(`本日の走行が ${total}km になっています。\nメーターの桁を間違えていませんか。\n\nこのまま完了しますか？`)) return;
            if(!confirm('本日の業務を完了しますか？')) return;
            historyList.value.unshift({
                dateStr: runDateStr(),
                startMileage: startMileage.value,
                startTime: startTime.value,
                vehicleNo: vehicleNumber.value,
                daily: normalizeDaily(daily.value),
                fareOverride: normalizeFareOverride(fareOverride.value),
                logs: logs.value,
                totalDistance: calculateTotalDistance.value
            });
            updateHistoryStorage();
            localStorage.removeItem('nippoData_pro_v3');
            resetRun();
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
        const circled = (n) => (n >= 1 && n <= 20 ? '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'[n - 1] : `(${n})`);
        const yen = (v) => Number(v).toLocaleString('ja-JP') + '円';

        const buildReportText = () => {
            const hist = viewingHistoryMode.value;
            const src = hist ? (historyData.value || {}) : null;
            const targetLogs = hist ? (src.logs || []) : logs.value;
            const startKm = hist ? src.startMileage : startMileage.value;
            const startAt = hist ? src.startTime : startTime.value;
            const date = hist ? src.dateStr : runDateStr();
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
                dateStr: hist ? src.dateStr : runDateStr(),
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
                fareOverride: normalizeFareOverride(activeFareOverride.value) || {},
                toll: toll || null,
                park: park || null
            };
        };

        // iOS は share() をタップと同じ操作の中で呼ばないと NotAllowedError で弾く。
        // タップを受けてから PDF を組むと間に合わず、毎回2回押しになっていた。
        // そこで確認画面を開いている間に今の内容で組んでおき、ボタンは組み終えたものを共有するだけにする。
        // 内容（nippoKey）が変わったら組み直す。組み終えるまでボタンは押せない
        const PDF_DEBOUNCE = 400;   // ms。数字を打っている間は組み直さない
        const nippoKey = computed(() =>
            (screen.value === 'summary' && !isEditing.value ? JSON.stringify(buildNippoData()) : ''));
        const pdf = ref({ key: '', state: 'idle', blob: null, name: '', error: '' });   // state: building | ready | failed
        const pdfState = computed(() => (pdf.value.key === nippoKey.value ? pdf.value.state : 'building'));

        const buildPdfFor = async (key) => {
            pdf.value = { key, state: 'building', blob: null, name: '', error: '' };
            try {
                // key から戻すのは、組んでいる間に画面の値が変わっても、組む内容を key と揃えるため
                const out = await NippoForm.buildPdf(JSON.parse(key));
                if (pdf.value.key === key) pdf.value = { key, state: 'ready', blob: out.blob, name: out.name, error: '' };
            } catch (e) {
                console.error(e);
                if (pdf.value.key === key) pdf.value = { key, state: 'failed', blob: null, name: '', error: (e && e.message) || '' };
            }
        };

        let pdfTimer = null;
        watch(nippoKey, (key) => {
            clearTimeout(pdfTimer);
            if (key && key !== pdf.value.key) pdfTimer = setTimeout(() => buildPdfFor(key), PDF_DEBOUNCE);
        });

        const shareNippoPdf = () => {
            if (pdfState.value === 'building') return;
            const data = buildNippoData();
            if (data.cases.length > NippoForm.MAX_CASES &&
                !confirm(`案件が ${data.cases.length} 件あります。\n日報は ${NippoForm.MAX_CASES} 件までなので、`
                         + `${NippoForm.MAX_CASES + 1} 件目以降は載りません。\n\nこのまま送りますか？`)) return;
            if (pdfState.value === 'failed') {
                alert('日報PDFを作れませんでした。\n' + pdf.value.error);
                buildPdfFor(nippoKey.value);
                return;
            }
            // await を挟まずに共有シートを開く（タップと同じ操作のうちに share() を呼ぶ）
            sharePdfFile(pdf.value.blob, pdf.value.name);
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
                        alert('PDFはできています。\nもう一度「日報PDFを送る」を押してください。');
                        return;
                    }
                    console.error(e);
                }
            }
            downloadBlob(blob, name);
            alert('この端末では共有シートを開けないため、PDFを保存しました。\nファイルアプリからLINEで送ってください。');
        };

        // 【修正 #3】ディープコピーで履歴を閲覧（元データを直接変更しない）
        const viewHistory = (item) => {
            viewingHistoryMode.value = true;
            isNewPastEntry.value = false;
            // 保存時の書き戻し先。編集で日付や時刻が変わっても見失わない
            editingIndex.value = historyList.value.indexOf(item);
            historyData.value = JSON.parse(JSON.stringify(item));
            fillDaily(historyData.value);
            fillFareOverride(historyData.value);
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
                fareOverride: emptyFareOverride(),
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
            screen, inputBuffer, lastAction, startMileage,
            historyList, viewingHistoryMode, historyData, showTextToast, showSettings,
            vehicleNumber, vehicleNumberHistory, vehicleNumberInput, vehiclePick, pickVehicleNumber,
            moveVehicleCaretToEnd, saveVehicleNumber, selectVehicleNumber, removeVehicleNumberFromHistory, startTime, undoStack, undo, handleHeaderBack,
            
            // Keypad
            appendDigit, removeDigit, meterDigits, meterBase,

            // Modal & Data
            // 【修正 #6】tempLocation エイリアスを廃止し tempAddress に統一
            tempAddress, tempTime, tempAccuracy, tempTollFee, tempParkingFee, locating, addressWaits, tempLat,
            historyIssue,
            tempDepartureTime, tempDestinationName, tempPaymentMethod, paymentChoice, tempRemarks, paymentOptions,
            confirmDeparture, handleArrival, confirmArrival, cancelModal, handleDeparture,

            // History & Backup
            currentHistoryPage, totalHistoryPages, paginatedHistory,
            downloadBackup, restoreBackup, clearAllHistory, deleteHistoryItem, clearLocations,
            
            // Intelligent History
            showCandidateList, toggleCandidateList, selectCandidate, deleteCandidate, nearbyLocations, destinationCandidates,
            startLocating,
            
            // Navigation
            startWork, goToSummary, backToDashboard, saveAndReset, viewHistory, closeSubScreens,
            groupedLogs, calculateTotalDistance, getLastMileage, getStatusText,
            todaySummary,
            buildReportText, shareReport, copyReportText,

            // 当日実績と日報PDF
            DAILY_FIELDS, DAILY_STICKY_FIELDS, DAILY_EXTRA_FIELDS, showDailyExtra, activeDaily, persistDaily, dailyFilled, nippoFare, tatekaeTotal,
            driverName, saveDriverName, shareNippoPdf, pdfState,

            // 金額の手直し
            FARE_SECTIONS, activeFareOverride, persistFareOverride, clearFareOverride,
            fareOverrideCount, fareAutoText, showFareEdit,

            // Edit Mode
            isEditing, editBuffer, enterEditMode, saveEditMode, cancelEditMode, removeGroupFromBuffer,
            isNewPastEntry, addGroupToBuffer, startPastEntry, editDateInput,
            getEditLastMileage, calculateEditTotalDistance
        };
    }
}).mount('#app');
