/* Adapted from human-review/src/anchor-text.js, MIT, Peter Yang.
 * Changes: ambiguous equally scored matches fail closed. See notices. */
export const CONTEXT_PAD = 32;
export function buildContext(text,start,end,pad=CONTEXT_PAD) {
  return {prefix:text.slice(Math.max(0,start-pad),start),quote:text.slice(start,end),suffix:text.slice(end,Math.min(text.length,end+pad))};
}
function commonSuffixLength(a,b) {let n=0;while(n<a.length&&n<b.length&&a[a.length-1-n]===b[b.length-1-n])n++;return n;}
function commonPrefixLength(a,b) {let n=0;while(n<a.length&&n<b.length&&a[n]===b[n])n++;return n;}
function occurrences(text,quote) {const found=[];let at=text.indexOf(quote);while(at!==-1){found.push(at);at=text.indexOf(quote,at+1);}return found;}
function bestHit(text,hits,quote,prefix,suffix) {
  let best=hits[0],bestScore=-1,ties=0;
  for(const at of hits) {
    const score=commonSuffixLength(prefix,text.slice(Math.max(0,at-prefix.length),at))+commonPrefixLength(suffix,text.slice(at+quote.length,at+quote.length+suffix.length));
    if(score>bestScore){best=at;bestScore=score;ties=1;}else if(score===bestScore)ties++;
  }
  return ties===1?{at:best,score:bestScore}:null;
}
const collapse=s=>String(s||'').replace(/\s+/g,' ');
function collapseWithMap(text) {
  let flat='',pendingWs=-1;const map=[];
  for(let i=0;i<text.length;i++) {
    if(/\s/.test(text[i])){if(pendingWs===-1)pendingWs=i;continue;}
    if(pendingWs!==-1&&flat){flat+=' ';map.push(pendingWs);}pendingWs=-1;flat+=text[i];map.push(i);
  }
  return {flat,map};
}
export function findQuote(text,ctx) {
  const quote=ctx&&ctx.quote;if(!quote)return null;
  const hits=occurrences(text,quote);
  if(hits.length===1)return {start:hits[0],end:hits[0]+quote.length,exact:true};
  if(hits.length>1){const best=bestHit(text,hits,quote,ctx.prefix||'',ctx.suffix||'');return best?{start:best.at,end:best.at+quote.length,exact:best.score>0}:null;}
  const {flat,map}=collapseWithMap(text);const flatQuote=collapse(quote).trim();if(!flatQuote||!map.length)return null;
  const flatHits=occurrences(flat,flatQuote);if(!flatHits.length)return null;
  const best=bestHit(flat,flatHits,flatQuote,collapse(ctx.prefix||''),collapse(ctx.suffix||''));
  return best?{start:map[best.at],end:map[best.at+flatQuote.length-1]+1,exact:false}:null;
}
