import { useEffect } from 'react';
export function Meta({title,description,path,noIndex=false}:{title:string;description:string;path:string;noIndex?:boolean}) {
 useEffect(()=>{
  document.title=`${title} | Carteio AI`;
  const descriptionTag=document.querySelector('meta[name="description"]'); descriptionTag?.setAttribute('content',description);
  let canonical=document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if(!canonical){canonical=document.createElement('link');canonical.rel='canonical';document.head.append(canonical);}
  canonical.href=`https://ai.carteio.in${path}`;
  let robots=document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if(noIndex){if(!robots){robots=document.createElement('meta');robots.name='robots';document.head.append(robots);}robots.content='noindex,nofollow';}
  else robots?.remove();
 },[title,description,path,noIndex]);
 return null;
}
