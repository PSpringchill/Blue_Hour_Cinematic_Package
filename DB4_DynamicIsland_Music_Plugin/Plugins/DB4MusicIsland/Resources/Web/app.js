/* DB4 Music Island — official YouTube IFrame Player API; no audio extraction. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const KEY = 'db4_music_island_v1';
  const YT_ERRORS = {2:'Invalid video ID',5:'This video cannot play in the embedded browser',100:'This video is unavailable',101:'Embedding disabled for this video',150:'Embedding disabled for this video',153:'YouTube requires an HTTP Referer; serve the page through http://127.0.0.1:8766/'};
  const s = {
    player: null, ready: false, apiReady: false, mode: 'videos', queue: [], index: 0,
    playlistId: '', shuffle: false, repeat: 0, playing: false, volume: 70, queueOpen: false,
    currentVideoId: '', startedAtLeastOnce: false, lastKnownTitle: '', lastError: ''
  };

  const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
  const isVideoId = v => /^[A-Za-z0-9_-]{11}$/.test(v || '');
  const isPlaylistId = v => /^[A-Za-z0-9_-]{12,130}$/.test(v || '');
  const thumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const title = (track, i) => track?.title || `YouTube video ${i + 1}`;
  const time = seconds => {
    const t = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };
  const msg = (text, level = '') => {
    $('statusLine').textContent = text;
    const row = $('statusLine').parentElement;
    row.classList.remove('ok', 'error');
    if (level) row.classList.add(level);
  };
  function parseYouTube(raw) {
    const value = raw.trim();
    if (isVideoId(value)) return {type:'video', id:value};
    if (isPlaylistId(value) && /^(PL|OLAK|UU|FL|RD|LL|WL)/.test(value)) return {type:'playlist', id:value};
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
    catch { return null; }
    const host = url.hostname.toLowerCase();
    if (!(host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com'))) return null;
    const list = url.searchParams.get('list');
    if (isPlaylistId(list)) return {type:'playlist', id:list};
    let id = url.searchParams.get('v');
    if (!id) {
      const segments = url.pathname.split('/').filter(Boolean);
      if (host === 'youtu.be') id = segments[0];
      else if (['embed','shorts','live','v'].includes(segments[0])) id = segments[1];
    }
    return isVideoId(id) ? {type:'video', id} : null;
  }
  function currentTrack() { return s.queue[s.index] || null; }
  function persist() {
    const data = {
      queue:s.mode === 'videos' ? s.queue.slice(0,150) : [], mode:s.mode,
      playlistId:s.playlistId,index:s.index,volume:s.volume,repeat:s.repeat,shuffle:s.shuffle
    };
    safe(() => localStorage.setItem(KEY, JSON.stringify(data)));
  }
  function restore() {
    const data = safe(() => JSON.parse(localStorage.getItem(KEY) || 'null'));
    if (!data || typeof data !== 'object') return;
    s.mode = data.mode === 'playlist' ? 'playlist' : 'videos';
    s.playlistId = isPlaylistId(data.playlistId) ? data.playlistId : '';
    s.queue = Array.isArray(data.queue) ? data.queue.filter(q => isVideoId(q?.id)).slice(0,150).map(q => ({id:q.id,title:String(q.title||'').slice(0,130)})) : [];
    s.index = Math.max(0, Math.min(Number(data.index)||0, s.queue.length-1));
    s.volume = Math.max(0,Math.min(100,Number(data.volume)||70));
    s.shuffle = !!data.shuffle;
    s.repeat = [0,1,2].includes(data.repeat) ? data.repeat : 0;
    if (s.mode === 'playlist' && !s.playlistId) s.mode = 'videos';
  }
  function getVideoData() { return safe(() => s.player?.getVideoData(), {}); }
  function activeId() {
    const active = getVideoData()?.video_id;
    return isVideoId(active) ? active : (currentTrack()?.id || '');
  }
  function updateHeader() {
    const track = currentTrack(), data = getVideoData();
    const id = activeId();
    const name = data?.title || track?.title || (s.mode === 'playlist' && s.playlistId ? 'YouTube Playlist' : 'Roadtrip Radio');
    $('nowTitle').textContent = name;
    $('nowSubtitle').textContent = (s.mode === 'playlist' ? 'YouTube playlist' : track ? `Track ${s.index + 1} of ${s.queue.length}` : 'Paste a YouTube link to begin');
    $('playStateLabel').textContent = s.playing ? 'NOW PLAYING' : (id || s.playlistId ? 'READY TO PLAY' : 'READY TO DRIVE');
    $('album').style.backgroundImage = id ? `url("${thumb(id)}")` : '';
    $('album').querySelector('.vinyl').style.display = id ? 'none' : 'block';
    $('openYouTube').href = id ? `https://www.youtube.com/watch?v=${id}` : s.playlistId ? `https://www.youtube.com/playlist?list=${s.playlistId}` : 'https://www.youtube.com/';
    document.body.classList.toggle('playing',s.playing);
    $('playIcon').hidden = s.playing;
    $('pauseIcon').hidden = !s.playing;
    $('playPause').setAttribute('aria-label',s.playing ? 'Pause' : 'Play');
    $('screenState').textContent = s.playing ? 'ON AIR' : (id || s.playlistId ? 'CUED' : 'STANDBY');
  }
  function updateModeButtons() {
    $('shuffle').classList.toggle('active',s.shuffle);
    $('repeat').classList.toggle('active',s.repeat !== 0);
    $('repeatMark').textContent = s.repeat === 2 ? '1' : '';
    $('repeat').title = ['Repeat off','Repeat all','Repeat one'][s.repeat];
    $('volume').value = String(s.volume);
    $('volumeLabel').textContent = `${s.volume}%`;
    $('queueToggle').setAttribute('aria-expanded',String(s.queueOpen));
    $('queuePanel').hidden = !s.queueOpen;
  }
  function updateQueue() {
    const list = $('queueItems');
    list.replaceChildren();
    $('queueCount').textContent = String(s.queue.length);
    if (!s.queue.length) {
      const empty = document.createElement('div'); empty.className='queue-empty';
      empty.textContent = s.mode === 'playlist' ? 'Loading playlist from YouTube…' : 'Your playlist is empty.';
      list.appendChild(empty); return;
    }
    s.queue.forEach((track, idx) => {
      const row = document.createElement('div'); row.className = `queue-entry${idx === s.index ? ' current' : ''}`; row.setAttribute('role','listitem');
      const img = document.createElement('img'); img.className='queue-thumb'; img.alt=''; img.loading='lazy'; img.src=thumb(track.id);
      const name = document.createElement('span'); name.className='queue-name'; name.textContent=title(track,idx); name.title=title(track,idx);
      const choose = document.createElement('button'); choose.type='button'; choose.title='Play this track'; choose.setAttribute('aria-label',`Play ${title(track,idx)}`); choose.textContent='▶';
      choose.addEventListener('click',()=>{s.index=idx;cueSelection(true);});
      row.append(img,name,choose);
      if (s.mode === 'videos') {
        const del=document.createElement('button'); del.type='button'; del.title='Remove track'; del.setAttribute('aria-label',`Remove ${title(track,idx)}`); del.textContent='×';
        del.addEventListener('click',()=>removeTrack(idx)); row.appendChild(del);
      }
      list.appendChild(row);
    });
  }
  function setPlayerVisible(show) { $('emptyPlayer').hidden = show; }
  function playerReady() {
    if (!s.ready) { msg('Connecting to YouTube…'); return false; }
    return true;
  }
  function cueSelection(startPlayback = false) {
    if (!playerReady()) return;
    try {
      if (s.mode === 'playlist') {
        if (!s.playlistId) return;
        const arg = {listType:'playlist',list:s.playlistId,index:Math.max(0,s.index),startSeconds:0};
        if (startPlayback) s.player.loadPlaylist(arg); else s.player.cuePlaylist(arg);
        s.player.setLoop(s.repeat === 1);
        s.player.setShuffle(s.shuffle);
      } else {
        const track = currentTrack(); if (!track) return;
        if (startPlayback) s.player.loadVideoById(track.id); else s.player.cueVideoById(track.id);
      }
      s.currentVideoId = activeId();
      setPlayerVisible(true);
      msg(startPlayback ? 'Starting playback…' : 'Ready. Press Play or use the YouTube player.','ok');
    } catch (error) { msg(`Could not cue video: ${error.message || error}`,'error'); }
    updateHeader(); updateQueue(); persist();
  }
  function syncNativePlaylist() {
    if (!s.ready || s.mode !== 'playlist') return;
    const ids = safe(()=>s.player.getPlaylist(), []);
    if (!Array.isArray(ids) || !ids.length) return;
    const cleaned = ids.filter(isVideoId).slice(0,150);
    if (!cleaned.length) return;
    const oldTitles = new Map(s.queue.map(t => [t.id,t.title]));
    const changed = s.queue.length !== cleaned.length || s.queue.some((t,i)=>t.id!==cleaned[i]);
    if (changed) s.queue = cleaned.map(id=>({id,title:oldTitles.get(id)||''}));
    const index = Number(safe(()=>s.player.getPlaylistIndex(),s.index));
    if (Number.isInteger(index) && index>=0 && index<s.queue.length) s.index=index;
    if (changed) updateQueue();
  }
  function updateTitleMetadata() {
    const data = getVideoData(), active = data?.video_id;
    if (!data || !isVideoId(active) || !data.title) return;
    const item = s.queue.find(t=>t.id===active);
    if (item && item.title !== data.title) { item.title = data.title.slice(0,130); updateQueue(); if(s.mode==='videos') persist(); }
  }
  function updateTime() {
    const duration = Math.max(0,Number(safe(()=>s.player?.getDuration(),0)||0));
    const current = Math.max(0,Number(safe(()=>s.player?.getCurrentTime(),0)||0));
    const seek = $('seek');
    if (document.activeElement !== seek) {seek.value = String(duration ? Math.floor(current/duration*1000) : 0);seek.style.setProperty('--seek-fill',`${duration?current/duration*100:0}%`);}
    $('elapsed').textContent=time(current); $('duration').textContent=time(duration);
  }
  function playbackState(event) {
    s.playing = event.data === YT.PlayerState.PLAYING;
    if (s.playing) {s.startedAtLeastOnce=true;msg('Streaming via official YouTube player','ok');}
    else if (event.data === YT.PlayerState.BUFFERING) msg('Buffering…');
    else if (event.data === YT.PlayerState.CUED) msg('Ready. Press play to start.','ok');
    else if (event.data === YT.PlayerState.PAUSED) msg('Paused');
    syncNativePlaylist();updateTitleMetadata();updateHeader();updateQueue();updateTime();
    if (event.data === YT.PlayerState.ENDED && s.mode === 'videos') onFinished();
  }
  function onFinished() {
    if (s.repeat === 2) {safe(()=>s.player.seekTo(0,true));safe(()=>s.player.playVideo());return;}
    next(false);
  }
  function next(fromButton = true) {
    if (!playerReady()) return;
    if (s.mode === 'playlist') {safe(()=>s.player.nextVideo()); return;}
    if (!s.queue.length) return;
    if (s.shuffle && s.queue.length > 1) {
      const others=s.queue.map((_,i)=>i).filter(i=>i!==s.index);
      s.index=others[Math.floor(Math.random()*others.length)];
    } else if (s.index < s.queue.length-1) s.index++;
    else if (s.repeat === 1 || fromButton) s.index=0;
    else {s.playing=false;updateHeader();return;}
    cueSelection(true);
  }
  function previous() {
    if (!playerReady()) return;
    if (Number(safe(()=>s.player.getCurrentTime(),0)) > 3) {safe(()=>s.player.seekTo(0,true));return;}
    if (s.mode === 'playlist') {safe(()=>s.player.previousVideo());return;}
    if (!s.queue.length) return;
    s.index=(s.index-1+s.queue.length)%s.queue.length;
    cueSelection(true);
  }
  function togglePlay() {
    if (!playerReady()) return;
    if (!currentTrack() && !s.playlistId) {msg('Paste a YouTube video or playlist URL first.','error');return;}
    if (s.playing) safe(()=>s.player.pauseVideo());
    else {
      if (s.mode === 'videos' && activeId() !== currentTrack()?.id) cueSelection(false);
      safe(()=>s.player.playVideo());
      msg('Requesting playback…');
    }
  }
  function removeTrack(i) {
    if (s.mode !== 'videos') return;
    const selected = i===s.index;
    s.queue.splice(i,1);
    if (i < s.index) s.index--;
    s.index=Math.max(0,Math.min(s.index,s.queue.length-1));
    if (!s.queue.length) {
      safe(()=>s.player.stopVideo()); s.playing=false; setPlayerVisible(false); s.currentVideoId='';msg('Queue cleared.');
    } else if (selected) cueSelection(false);
    updateQueue();updateHeader();persist();
  }
  function addFromInput(raw) {
    const parsed = parseYouTube(raw);
    if (!parsed) {msg('Enter a valid YouTube video or playlist URL.','error');return;}
    if (parsed.type==='playlist') {
      s.mode='playlist';s.playlistId=parsed.id;s.queue=[];s.index=0;
      msg('Loading YouTube playlist…');
      cueSelection(false);
    } else {
      if (s.mode!=='videos') {s.mode='videos';s.playlistId='';s.queue=[];s.index=0;}
      if (s.queue.length>=150) {msg('Queue limit: 150 entries.','error');return;}
      const first=s.queue.length===0;
      s.queue.push({id:parsed.id,title:''});
      if (first) {s.index=0;cueSelection(false);}
      else msg('Added to your playlist.','ok');
    }
    $('youtubeInput').value='';
    updateHeader();updateQueue();persist();
  }
  function onApiReady() {
    s.apiReady=true;
    s.player=new YT.Player('ytPlayer',{
      width:'100%',height:'100%',playerVars:{playsinline:1,autoplay:0,controls:1,origin:window.location.origin,enablejsapi:1,rel:0},
      events:{
        onReady:(event)=>{
          s.ready=true;
          event.target.setVolume(s.volume);
          if (s.mode==='playlist' && s.playlistId || s.mode==='videos' && s.queue.length) cueSelection(false);
          else msg('Paste a YouTube link to begin.','ok');
          updateHeader();
        },
        onStateChange:playbackState,
        onError:(event)=>{ s.playing=false;msg(YT_ERRORS[event.data]||`YouTube playback error ${event.data}`,'error');updateHeader(); },
        onAutoplayBlocked:()=>msg('Playback blocked by browser. Press the YouTube Play button.','error')
      }
    });
  }
  function setup() {
    restore();updateModeButtons();updateQueue();updateHeader();
    $('queueToggle').addEventListener('click',()=>{s.queueOpen=!s.queueOpen;updateModeButtons();});
    $('addForm').addEventListener('submit',e=>{e.preventDefault();addFromInput($('youtubeInput').value);});
    $('playPause').addEventListener('click',togglePlay);
    $('prev').addEventListener('click',previous);
    $('next').addEventListener('click',()=>next(true));
    $('shuffle').addEventListener('click',()=>{
      s.shuffle=!s.shuffle;
      if (s.mode==='playlist' && s.ready) safe(()=>s.player.setShuffle(s.shuffle));
      updateModeButtons();persist();
    });
    $('repeat').addEventListener('click',()=>{
      s.repeat=(s.repeat+1)%3;
      if (s.mode==='playlist' && s.ready) safe(()=>s.player.setLoop(s.repeat!==0));
      updateModeButtons();persist();
    });
    $('volume').addEventListener('input',e=>{s.volume=Number(e.target.value);$('volumeLabel').textContent=`${s.volume}%`;if(s.ready)safe(()=>s.player.setVolume(s.volume));persist();});
    $('seek').addEventListener('input',e=>e.target.style.setProperty('--seek-fill',`${Number(e.target.value)/10}%`));
    $('seek').addEventListener('change',e=>{
      const dur=Number(safe(()=>s.player?.getDuration(),0)||0);
      if(dur>0)safe(()=>s.player.seekTo(dur*Number(e.target.value)/1000,true));
    });
    $('clearQueue').addEventListener('click',()=>{
      safe(()=>s.player?.stopVideo());s.queue=[];s.index=0;s.playlistId='';s.mode='videos';s.playing=false;
      setPlayerVisible(false);updateQueue();updateHeader();persist();msg('Queue cleared.');
    });
    document.addEventListener('keydown',e=>{
      if (e.target.closest('input,textarea,button') || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code==='Space') { e.preventDefault();togglePlay(); }
    });
    // Video remains rendered while playing. If the game hides this widget, the UE wrapper pauses it.
    window.DB4Music={pause(){safe(()=>s.player?.pauseVideo());},isPlaying(){return s.playing;},load:addFromInput};
    setInterval(()=>{
      if (!s.ready) return;
      updateTime();
      if(s.mode==='playlist')syncNativePlaylist();
      if(s.playing){updateTitleMetadata();updateHeader();}
    },600);
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
    script.onerror=()=>msg('Cannot load YouTube API. Check internet access / Unreal WebBrowser support.','error');
    window.onYouTubeIframeAPIReady=onApiReady;
    document.head.appendChild(script);
    setTimeout(()=>{if(!s.apiReady)msg('Still connecting to YouTube. Network or embedded browser may be unavailable.','error');},15000);
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup,{once:true}); else setup();
})();
