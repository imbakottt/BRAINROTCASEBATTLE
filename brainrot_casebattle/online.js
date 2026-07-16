(() => {
  'use strict';
  const cfg = window.BRAINROT_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  let db = null, user = null, presence = null, profileTimer = 0;
  const rewarded = new Set(JSON.parse(localStorage.getItem('bcb_rewarded_rooms') || '[]'));
  const $o = s => document.querySelector(s);
  const safe = v => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const playerName = () => localStorage.getItem('bcb_player_name') || ('Игрок ' + Math.floor(1000 + Math.random() * 8999));
  if (!localStorage.getItem('bcb_player_name')) localStorage.setItem('bcb_player_name', playerName());
  const setStatus = (online, label) => {
    const n = $o('#onlineCount'), s = $o('#netState');
    if (n) n.textContent = online;
    if (s) s.textContent = label;
  };
  function dropHTML(d) {
    const src = d.item_file ? img(d.item_file) : img('TralaleroTralala');
    return `<div class="drop-chip r-${safe(d.rarity || 'rare')}"><img src="${safe(src)}" alt=""><div><b>${safe(d.item_name)}</b><small>${safe(d.player_name || 'Игрок')} · ${safe(d.rarity || 'Rare')}</small></div><strong>${fmt(d.value || 0)}</strong></div>`;
  }
  function paintDrops(rows) {
    const el = $o('#dropTrack'); if (!el) return;
    const list = rows.length ? rows : demoDrops();
    const doubled = list.concat(list);
    el.innerHTML = doubled.map(dropHTML).join('');
  }
  function prependDrop(d) {
    const el = $o('#dropTrack'); if (!el) return;
    el.insertAdjacentHTML('afterbegin', dropHTML(d));
    while (el.children.length > 20) el.lastElementChild.remove();
  }
  function demoDrops() {
    const picks = (typeof ALL_ITEMS !== 'undefined' ? ALL_ITEMS : []).slice(-7).reverse();
    return picks.map((it, i) => ({player_name:['NeoFox','Кот228','Mango','xVortex','Lime','Raven','Bober'][i],item_name:it.name,item_file:it.file,rarity:it.rarity,value:it.val}));
  }
  function demoLeaders() {
    const names=['VORTEX','brainrot.exe','MangoKing','Кот228','NeoFox','Bober','LuckyOne','Nikita','Raven','Lime'];
    return names.map((display_name,i)=>({display_name,total_value:184200-i*(12400-i*310),battles_won:41-i*3}));
  }
  function paintLeaders(rows) {
    const el=$o('#leaderRows'); if(!el)return;
    el.innerHTML=rows.map((p,i)=>`<div class="leader-row"><div class="rank">#${i+1}</div><div class="player-cell"><span class="avatar-dot">${safe((p.display_name||'?')[0].toUpperCase())}</span>${safe(p.display_name||'Игрок')}</div><div class="leader-value">${fmt(p.total_value||0)} 💰</div><div class="leader-wins">${p.battles_won||0} побед</div></div>`).join('') || '<div class="room-empty">Пока никто не попал в рейтинг</div>';
  }
  async function loadLeaders() {
    if(!db){paintLeaders(demoLeaders());return;}
    const {data,error}=await db.from('profiles').select('display_name,total_value,battles_won').order('total_value',{ascending:false}).limit(25);
    if(error){console.warn(error);paintLeaders(demoLeaders());return;} paintLeaders(data||[]);
  }
  async function loadDrops() {
    if(!db){paintDrops([]);return;}
    const {data}=await db.from('drops').select('player_name,item_name,item_file,rarity,mutation,value,created_at').order('created_at',{ascending:false}).limit(10);
    paintDrops(data||[]);
  }
  async function publishDrops(items) {
    if(!db||!user||!items?.length)return;
    const rows=items.filter(it=>rarRank(it.rarity)>=rarRank('rare')).slice(0,5).map(it=>({user_id:user.id,player_name:playerName(),item_name:it.name,item_file:it.file,rarity:it.rarity,mutation:it.mut||'none',value:itemVal(it)}));
    if(rows.length) await db.from('drops').insert(rows);
  }
  window.onlinePublishDrop=publishDrops;
  window.onlineSyncProfile=() => {
    clearTimeout(profileTimer);
    profileTimer=setTimeout(async()=>{
      if(!db||!user)return;
      const total=Math.max(0,Math.round(state.coins+state.inv.reduce((s,it)=>s+itemVal(it),0)));
      await db.from('profiles').upsert({id:user.id,display_name:playerName(),total_value:total,battles_won:state.stats.battleWins||0,updated_at:new Date().toISOString()});
    },900);
  };
  function battleCard(r) {
    return `<div class="room"><div><b>⚔️ ${safe(r.host_name)} ждёт соперника</b><small>${safe(r.case_name)} · ${r.rounds} раунд(а) · вход ${fmt(r.entry_price)} 💰</small></div><button class="btn sm" data-join="${safe(r.id)}">Войти</button></div>`;
  }
  async function loadRooms() {
    const el=$o('#roomList'); if(!el)return;
    if(!db){el.innerHTML='<div class="room-empty">Демо-режим: подключите Supabase, чтобы комнаты стали общими для всех игроков.</div>';return;}
    const {data,error}=await db.from('battle_rooms').select('*').eq('status','waiting').order('created_at',{ascending:false}).limit(12);
    if(error){el.innerHTML='<div class="room-empty">Не удалось загрузить комнаты</div>';return;}
    el.innerHTML=(data||[]).map(battleCard).join('')||'<div class="room-empty">Нет открытых комнат — создайте первую</div>';
    el.querySelectorAll('[data-join]').forEach(b=>b.onclick=()=>joinBattle(b.dataset.join));
  }
  async function createBattle() {
    if(!db||!user){toast('Сначала подключите Supabase по README');return;}
    const c=caseById($o('#onlineCase').value), rounds=+$o('#onlineRounds').value, price=c.price*rounds;
    if(state.coins<price){toast('Не хватает монет');return;}
    const {data,error}=await db.from('battle_rooms').insert({host_id:user.id,host_name:playerName(),case_id:c.id,case_name:c.name,rounds,entry_price:price}).select().single();
    if(error){toast('Ошибка создания комнаты');console.warn(error);return;}
    state.coins-=price;save();renderBalance();showWaiting(data);loadRooms();
  }
  async function joinBattle(id) {
    if(!db||!user)return;
    const room=(await db.from('battle_rooms').select('*').eq('id',id).single()).data;
    if(!room)return;
    if(state.coins<room.entry_price){toast('Не хватает монет для входа');return;}
    const {data,error}=await db.rpc('join_battle',{room_uuid:id,joining_name:playerName()});
    if(error){toast(error.message||'Комната уже занята');loadRooms();return;}
    state.coins-=room.entry_price;save();renderBalance();applyBattleResult(data);loadRooms();loadLeaders();
  }
  function showWaiting(r) {
    const el=$o('#roomStage');el.classList.add('show');
    el.innerHTML=`<div class="live-tag">КОМНАТА СОЗДАНА</div><h3>Ждём второго игрока…</h3><div class="duel"><div class="fighter"><div class="avatar">🧠</div>${safe(r.host_name)}</div><div class="vs">VS</div><div class="fighter"><div class="avatar">?</div>Поиск</div></div><div class="hint">Комната обновится автоматически</div>`;
  }
  function applyBattleResult(r) {
    if(!r||r.status!=='finished')return;
    const mine=r.winner_id===user?.id;
    const el=$o('#roomStage'); el.classList.add('show');
    const hostWin=r.winner_id===r.host_id;
    el.innerHTML=`<div class="live-tag">БАТЛ ЗАВЕРШЁН</div><h3>${mine?'🏆 Победа!':'Батл завершён'}</h3><div class="duel"><div class="fighter ${hostWin?'win':''}"><div class="avatar">🧠</div>${safe(r.host_name)}<strong>${fmt(r.host_score)}</strong></div><div class="vs">VS</div><div class="fighter ${!hostWin?'win':''}"><div class="avatar">⚡</div>${safe(r.guest_name)}<strong>${fmt(r.guest_score)}</strong></div></div>`;
    if(mine&&!rewarded.has(r.id)){
      const reward=Math.max(r.host_score||0,r.guest_score||0); state.coins+=reward;state.stats.battleWins++;state.stats.battles++;rewarded.add(r.id);localStorage.setItem('bcb_rewarded_rooms',JSON.stringify([...rewarded].slice(-100)));save();renderBalance();sfxJackpot();burstConfetti(45);toast('Победа в онлайн-батле: +'+fmt(reward));
    } else if(!mine&&!rewarded.has(r.id)){state.stats.battles++;rewarded.add(r.id);localStorage.setItem('bcb_rewarded_rooms',JSON.stringify([...rewarded].slice(-100)));save();}
  }
  function fillBattleControls(){
    const c=$o('#onlineCase'); if(c)c.innerHTML=CASES.map(x=>`<option value="${x.id}">${x.emoji} ${safe(x.name)} — ${fmt(x.price)}</option>`).join('');
    $o('#createOnlineBattle').onclick=createBattle; $o('#refreshRooms').onclick=loadRooms;
  }
  async function startReal() {
    try{
      db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
      let {data:{session}}=await db.auth.getSession();
      if(!session){const out=await db.auth.signInAnonymously();if(out.error)throw out.error;session=out.data.session;}
      user=session.user;setStatus('1','подключение…');
      await Promise.all([loadDrops(),loadLeaders(),loadRooms()]); window.onlineSyncProfile();
      presence=db.channel('brainrot-online',{config:{presence:{key:user.id}}});
      presence.on('presence',{event:'sync'},()=>{const n=Object.keys(presence.presenceState()).length;setStatus(n,'онлайн сейчас');}).subscribe(async status=>{if(status==='SUBSCRIBED')await presence.track({name:playerName(),at:new Date().toISOString()});});
      db.channel('brainrot-events').on('postgres_changes',{event:'INSERT',schema:'public',table:'drops'},p=>prependDrop(p.new)).on('postgres_changes',{event:'*',schema:'public',table:'battle_rooms'},p=>{loadRooms();const r=p.new;if(r&&(r.host_id===user.id||r.guest_id===user.id))applyBattleResult(r);}).subscribe();
      setInterval(loadLeaders,30000);
    }catch(err){console.warn('Online init:',err);demo();toast('Онлайн не подключён — проверьте config.js');}
  }
  function demo(){setStatus(24,'демо-режим');paintDrops([]);paintLeaders(demoLeaders());loadRooms();}
  function initOnline(){
    fillBattleControls();
    const original=window.finalizeOpen;
    if(typeof original==='function')window.finalizeOpen=function(items){original(items);publishDrops(items);};
    if(!configured||!window.supabase){demo();const note=$o('#setupNote');if(note)note.hidden=false;}else startReal();
    document.querySelector('[data-view="leaders"]')?.addEventListener('click',loadLeaders);
  }
  initOnline();
})();
