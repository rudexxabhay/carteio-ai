import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Package, ShoppingCart, Bot, SlidersHorizontal, FlaskConical, Database, Globe2, Workflow, Blocks, Puzzle, Paintbrush, MessagesSquare, Headset, ChartColumnIncreasing, CreditCard, Settings2, Users, Receipt, RefreshCcw, BookOpen, ShieldCheck,  Store, ClipboardList, FileText } from 'lucide-react';

export type PageId = 'overview' | 'products' | 'product-detail' | 'sales' | 'order-detail' | 'assistants' | 'train' | 'behavior' | 'playground' | 'knowledge' | 'source-detail' | 'crawler' | 'crawl-detail' | 'builder' | 'integrations' | 'shopify' | 'install' | 'appearance' | 'conversations' | 'handoff' | 'case-detail' | 'handoff-rules' | 'analytics' | 'billing' | 'invoices' | 'settings' | 'team' | 'sync';
export type NavItem={id:PageId; label:string; icon:LucideIcon; group:string};
export const nav:NavItem[] = [
  {id:'overview',label:'Overview',icon:LayoutDashboard,group:'WORKSPACE'},
  {id:'products',label:'Products',icon:Package,group:'COMMERCE'},
  {id:'sales',label:'Sales & Orders',icon:ShoppingCart,group:'COMMERCE'},
  {id:'assistants',label:'AI Assistants',icon:Bot,group:'TRAIN AI'},
  {id:'train',label:'Train AI',icon:SlidersHorizontal,group:'TRAIN AI'},
  {id:'playground',label:'Playground',icon:FlaskConical,group:'TRAIN AI'},
  {id:'knowledge',label:'Knowledge Base',icon:Database,group:'TRAIN AI'},
  {id:'builder',label:'Agent Builder',icon:Workflow,group:'TRAIN AI'},
  {id:'integrations',label:'Integrations',icon:Blocks,group:'CHANNELS'},
  {id:'install',label:'Widget & Install',icon:Puzzle,group:'CHANNELS'},
  {id:'conversations',label:'Conversations',icon:MessagesSquare,group:'CUSTOMER SUPPORT'},
  {id:'handoff',label:'Human Handoff',icon:Headset,group:'CUSTOMER SUPPORT'},
  {id:'analytics',label:'Analytics',icon:ChartColumnIncreasing,group:'INSIGHTS'},
  {id:'billing',label:'Billing',icon:CreditCard,group:'INSIGHTS'},
  {id:'settings',label:'Settings & Team',icon:Settings2,group:'ADMIN'},
];
export const extra:{id:PageId;title:string;parent:PageId;icon:LucideIcon}[]=[
  {id:'product-detail',title:'Product Details',parent:'products',icon:Package},
  {id:'order-detail',title:'Order Details',parent:'sales',icon:ShoppingCart},
  {id:'behavior',title:'Bot Behavior',parent:'train',icon:SlidersHorizontal},
  {id:'source-detail',title:'Knowledge Source Details',parent:'knowledge',icon:FileText},
  {id:'crawl-detail',title:'Crawl Details',parent:'crawler',icon:Globe2},
  {id:'shopify',title:'Shopify Integration',parent:'integrations',icon:Store},
  {id:'appearance',title:'Widget Appearance',parent:'install',icon:Paintbrush},
  {id:'case-detail',title:'Handoff Case',parent:'handoff',icon:ClipboardList},
  {id:'handoff-rules',title:'Handoff Rules',parent:'handoff',icon:ShieldCheck},
  {id:'invoices',title:'Billing History',parent:'billing',icon:Receipt},
  {id:'team',title:'Team & Permissions',parent:'settings',icon:Users},
  {id:'sync',title:'Shopify Sync Monitor',parent:'integrations',icon:RefreshCcw}
];
export const pageTitles:Record<PageId,string>={overview:'Dashboard Overview',products:'Products','product-detail':'Product Details',sales:'Sales & Orders','order-detail':'Order Details',assistants:'AI Assistants',train:'Train your AI',behavior:'Bot Behavior',playground:'AI Playground',knowledge:'Knowledge Base','source-detail':'Knowledge Source Details',crawler:'Website Crawler','crawl-detail':'Crawl Details',builder:'Agent Builder',integrations:'Integrations',shopify:'Shopify Integration',install:'Widget & Installation',appearance:'Widget Appearance',conversations:'Conversations',handoff:'Human Handoff Center','case-detail':'Handoff Case','handoff-rules':'Handoff Rules',analytics:'Analytics',billing:'Billing & Plans',invoices:'Billing History',settings:'Workspace Settings',team:'Team & Permissions',sync:'Product Sync Monitor'};
export const sections=[{id:'assistants' as PageId,title:'AI Assistants',desc:'Create and manage customer-facing AI experiences',icon:Bot},{id:'behavior' as PageId,title:'Bot Behavior',desc:'Set brand voice, language and response guidance',icon:SlidersHorizontal},{id:'knowledge' as PageId,title:'Knowledge Base',desc:'Manage grounded knowledge and business data',icon:BookOpen},{id:'playground' as PageId,title:'Playground',desc:'Test replies and inspect sources',icon:FlaskConical},{id:'handoff-rules' as PageId,title:'Escalation',desc:'Route complex conversations to people',icon:Headset}];
