import { apiGet, apiPatch } from './client';
export type WidgetAppearance = {name:string;welcomeMessage:string;color:string;userBubbleColor:string;position:'left'|'right';fontFamily:'system'|'inter'|'arial'|'georgia'|'verdana';desktopSize:'small'|'medium'|'large'|'custom';width:number;height:number;mobileWidth:number;mobileHeight:number;cornerRadius:number;launcherSize:number;avatarUrl:string|null;suggestions:string[]};
export type WidgetConfig = { id?:string; assistantId:string; publicId:string; enabled:boolean; allowedDomains:string[]; appearance:WidgetAppearance };
export const getWidgetConfig=(slug:string,assistantId?:string,signal?:AbortSignal)=>apiGet<WidgetConfig>(`/workspaces/${encodeURIComponent(slug)}/widget${assistantId?`?assistantId=${encodeURIComponent(assistantId)}`:''}`,signal);
export type WidgetConfigInput = Pick<WidgetConfig, 'assistantId'|'enabled'|'allowedDomains'|'appearance'>;
export const saveWidgetConfig=(slug:string,input:WidgetConfigInput)=>apiPatch<WidgetConfig>(`/workspaces/${encodeURIComponent(slug)}/widget`,input);
