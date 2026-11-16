import {NextRequest} from 'next/server';
/** Local development only. Compare the browser Origin with the actual Host header;
 * Next.js may normalize nextUrl.hostname to localhost internally. */
export function isLocalAutomationRequest(req:NextRequest):boolean {
 if(process.env.NODE_ENV==='production')return false;
 const host=req.headers.get('host');if(!host)return false;
 let target:URL;try{target=new URL(`${req.nextUrl.protocol}//${host}`)}catch{return false}
 if(!['127.0.0.1','localhost'].includes(target.hostname))return false;
 const origin=req.headers.get('origin');if(!origin)return true;
 try {const source=new URL(origin);return source.origin===target.origin}catch{return false}
}
