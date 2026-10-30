const $=s=>document.querySelector(s),SETTINGS='dovale-vault-prefs'
const money=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const pad=id=>String(id).padStart(3,'0')
let sector=0,selected=null,busy=false,timer=null,audio=null,sound=false,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches
// Estado vem do servidor: cofres abertos da sala, cliente identificado e revelação em andamento
let opened={},cliente=null,pending=null

try{const p=JSON.parse(localStorage.getItem(SETTINGS)||'{}');sound=!!p.sound;reduced=p.reduced??reduced}catch{}

async function api(path,body){
  const r=await fetch('/api/cofres/'+path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined)
  const j=await r.json().catch(()=>({}))
  if(!r.ok)throw Error(j.erro||'Falha ao falar com o servidor.')
  return j
}
async function loadRoom(){opened=(await api('sala')).abertos;render()}

function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',5000)}
function vaultHTML(id,modal=false){const p=modal?null:opened[id]
return `<button class="vault ${p&&!modal?'open':''} ${modal?'modal-vault':''}" data-id="${id}" ${p&&!modal?'disabled':''} aria-label="Cofre ${pad(id)}${p?' — aberto, '+money(p):' — disponível'}"><span class="door"><span class="number">${pad(id)}</span><img class="door-logo" src="dovale.png" alt="" aria-hidden="true"><span class="wheel"></span><span class="slot"></span><span class="indicator"></span></span>${p&&!modal?`<span class="result-label">Aberto · ${money(p)}</span>`:''}</button>`}
function renderCliente(){
  $('#saldo').textContent=cliente?cliente.saldo:'—'
  $('#cliente-info').innerHTML=cliente
    ?`<b></b> · ${cliente.chaves.toLocaleString('pt-BR')} chaves · <em>${cliente.saldo} ${cliente.saldo===1?'cofre':'cofres'} para abrir</em>`
    :'Digite o código do cliente para ver quantos cofres ele pode abrir.'
  if(cliente)$('#cliente-info b').textContent=`${cliente.codigo} · ${cliente.nome}`
}
function render(){
  $('#available').textContent=200-Object.keys(opened).length
  renderCliente()
  $('#wall').innerHTML=Array.from({length:20},(_,i)=>vaultHTML(sector*20+i+1)).join('')
  const n=String(sector+1).padStart(2,'0')
  $('#sector-label').textContent='SETOR '+n
  $('#sector-name').textContent='Setor '+n
  $('#range').textContent=pad(sector*20+1)+' — '+pad(sector*20+20)
  $('#dots').innerHTML=Array.from({length:10},(_,i)=>`<button class="${i===sector?'active':''}" aria-label="Ir para setor ${i+1}" ${i===sector?'aria-current="true"':''} data-sector="${i}"></button>`).join('')
}
function open(content){$('#modal-body').innerHTML=content;if(!$('#modal').open)$('#modal').showModal()}
function close(){if(busy)return;$('#modal').close();selected=null;render()}

function select(id){if(busy||opened[id])return
  if(!cliente){toast('Digite o código do cliente para abrir um cofre.');$('#codigo').focus();return}
  if(!cliente.saldo){toast(`${cliente.nome} não tem cofres para abrir. A cada 1.000 chaves, 1 cofre.`);return}
  selected=id
  open(`<p class="eyebrow" style="justify-content:center">COFRE ${pad(id)}</p>${vaultHTML(id,true)}<h2>Abrir este cofre?</h2><p>Um novo prêmio espera por você.<br>Restam ${cliente.saldo} ${cliente.saldo===1?'cofre':'cofres'} para este cliente.</p><div class="actions"><button class="secondary" id="cancel">Voltar à sala</button><button class="primary" id="confirm">Sim, abrir cofre</button></div>`)
  $('#cancel').onclick=close
  $('#confirm').onclick=begin}
function tone(freq,duration=.15,type='sine',delay=0){if(!sound)return
  try{audio??=new AudioContext();audio.resume()
  const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.value=freq;o.connect(g);g.connect(audio.destination)
  const t=audio.currentTime+delay;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.08,t+.015);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.start(t);o.stop(t+duration)}catch{}}
async function begin(){if(busy)return
  busy=true;$('#confirm').disabled=true
  try{const r=await api('abrir',{codigo:cliente.codigo,cofre:selected})
    opened[selected]=r.premio;cliente=r.cliente;pending={id:selected,prize:r.premio}
    render();suspense()}
  catch(e){busy=false;toast(e.message);close();loadRoom().catch(()=>{})}}
function suspense(){busy=true;$('#close').hidden=true
  let start=performance.now(),last=0
  open(`<div class="opening">${vaultHTML(pending.id,true)}<div class="count" role="status" aria-live="polite">3</div><p>O próximo segredo está quase revelado…</p></div><button class="skip" id="skip">Pular animação</button>`)
  $('#skip').onclick=reveal
  const tick=()=>{const elapsed=performance.now()-start,n=Math.max(1,3-Math.floor(elapsed/1000))
    if(n!==last){$('.count').textContent=n;last=n;tone(160+(3-n)*60,.25,'triangle')}
    if(elapsed>=3000){reveal();return}
    timer=setTimeout(tick,80)}
  if(reduced)timer=setTimeout(reveal,300);else tick()}
function reveal(){clearTimeout(timer)
  if(!pending)return
  const {id,prize}=pending,level=prize===15?3:prize>=10?2:prize>=5?1:0,count=reduced?0:[10,28,65,110][level]
  const particles=Array.from({length:count},()=>`<i style="--x:${Math.random()*100}%;--c:${['#ffdc00','#1469ff','#ffffff'][Math.floor(Math.random()*3)]};--d:${1.8+Math.random()*2}s;--delay:${Math.random()*.6}s"></i>`).join('')
  open(`<div class="particles">${particles}</div><div class="reward level-${level}"><img class="reward-logo" src="dovale.png" alt="Dovale"><p class="badge">${prize===15?'PRÊMIO MÁXIMO!':'SEGREDO REVELADO'}</p><h2>Você ganhou!</h2><div class="value" role="status">${money(prize)}</div><p>Cofre ${pad(id)} · <span id="reveal-nome"></span><br>${cliente.saldo?`Ainda ${cliente.saldo===1?'resta 1 cofre':`restam ${cliente.saldo} cofres`} para abrir.`:'Mais uma conquista para a sua coleção.'}</p><button class="primary" id="continue">Continuar explorando</button></div>`)
  $('#reveal-nome').textContent=cliente.nome;
  [392,494,587,...(level>=2?[784,988]:[])].forEach((f,i)=>tone(f,.45,'sine',i*.11))
  $('#continue').onclick=finish}
function finish(){pending=null;busy=false;$('#close').hidden=false;close()}
function navigate(n){if(busy)return;sector=(n+10)%10;render()}

$('#cliente-form').onsubmit=async e=>{e.preventDefault();if(busy)return
  const btn=$('#entrar');btn.disabled=true
  try{cliente=await api('cliente/'+encodeURIComponent($('#codigo').value.trim()));renderCliente()}
  catch(err){cliente=null;renderCliente();toast(err.message)}
  finally{btn.disabled=false}}
$('#sair').onclick=()=>{if(busy)return;cliente=null;$('#codigo').value='';renderCliente();$('#codigo').focus()}

$('#wall').onclick=e=>{const el=e.target.closest('[data-id]');if(el)select(Number(el.dataset.id))}
$('#dots').onclick=e=>{const b=e.target.closest('[data-sector]');if(b)navigate(Number(b.dataset.sector))}
$('#prev').onclick=()=>navigate(sector-1)
$('#next').onclick=()=>navigate(sector+1)
let touchX=0,touchY=0
$('#scene').addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX;touchY=e.changedTouches[0].clientY},{passive:true})
$('#scene').addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX,dy=e.changedTouches[0].clientY-touchY
  if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.4)navigate(sector+(dx<0?1:-1))},{passive:true})
document.addEventListener('keydown',e=>{if($('#modal').open||e.target.matches('input'))return
  if(e.key==='ArrowLeft')navigate(sector-1)
  if(e.key==='ArrowRight')navigate(sector+1)})

$('#close').onclick=close
$('#modal').addEventListener('cancel',e=>{e.preventDefault();if(!busy)close()})
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')&&!busy)close()})

function prefs(){document.body.classList.toggle('reduced',reduced)
  $('#sound').textContent=sound?'Som: on':'Som: off';$('#sound').setAttribute('aria-pressed',sound)
  $('#motion').textContent=reduced?'Movimento reduzido: on':'Reduzir movimento';$('#motion').setAttribute('aria-pressed',reduced)
  try{localStorage.setItem(SETTINGS,JSON.stringify({sound,reduced}))}catch{}}
$('#sound').onclick=()=>{sound=!sound;prefs();tone(440)}
$('#motion').onclick=()=>{reduced=!reduced;prefs()}

$('#help').onclick=()=>{if(busy)return
  open(`<div class="help-copy"><p class="eyebrow">BEM-VINDO À SALA</p><h2>Cada chave abre possibilidades.</h2><p>A cada <b>1.000 chaves compradas</b>, o cliente ganha <b>1 cofre</b> para abrir. Contam os pedidos faturados e em aberto em SJC e MG.</p><ul><li>Digite o código do cliente para ver o nome e quantos cofres ele pode abrir.</li><li>São 200 cofres em 10 setores. Use as setas ou deslize no celular.</li><li>Escolha uma porta e confirme para revelar um prêmio.</li><li>Os prêmios vão de R$ 3 a R$ 15. Número, posição e tamanho não alteram a chance.</li><li>O sorteio considera as unidades restantes: 75 × R$ 3; 45 × R$ 4; 35 × R$ 5; 25 × R$ 7; 10 × R$ 10; 7 × R$ 12; 3 × R$ 15. Total: R$ 984.</li><li>Cada cofre só pode ser aberto uma vez e fica registrado para todos.</li></ul></div><button class="primary" id="understood">Vamos explorar</button>`)
  $('#understood').onclick=close}

$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{toast('Use o modo de tela cheia do navegador para exibir na TV.')}}
document.addEventListener('fullscreenchange',()=>{const full=!!document.fullscreenElement
  $('#fullscreen').textContent=full?'Sair da tela cheia':'Tela cheia';$('#fullscreen').setAttribute('aria-pressed',full)})

prefs()
render()
loadRoom().catch(e=>toast(e.message))
