import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetInstallationPage } from '../pages/saas/WidgetInstallationPage';
import { listAssistants } from '../services/api/assistants';
import { getWidgetConfig } from '../services/api/widget';

vi.mock('../services/api/assistants', () => ({ listAssistants: vi.fn() }));
vi.mock('../services/api/widget', () => ({ getWidgetConfig: vi.fn(), saveWidgetConfig: vi.fn() }));
const config:any={assistantId:'assistant-id',publicId:'widget_public_id_123456',enabled:true,allowedDomains:['shop.example.com'],appearance:{name:'Shop assistant',welcomeMessage:'Welcome',color:'#3157d5',position:'right',userBubbleColor:'#3157d5',fontFamily:'system',desktopSize:'medium',width:380,height:590,mobileWidth:420,mobileHeight:720,cornerRadius:20,launcherSize:58,avatarUrl:null,suggestions:['Shipping times?']}};

describe('WidgetInstallationPage',()=>{
 beforeEach(()=>{vi.mocked(listAssistants).mockResolvedValue({assistants:[{id:'assistant-id',name:'Shop assistant',status:'active'}] as any,page:1,pageSize:100,total:1});vi.mocked(getWidgetConfig).mockResolvedValue(config)});
 it('exposes labeled controls and a customer-free live preview',async()=>{
  const {container}=render(<MemoryRouter initialEntries={['/workspace/shop/widget']}><Routes><Route path="/workspace/:slug/widget" element={<WidgetInstallationPage/>}/></Routes></MemoryRouter>);
  await screen.findByRole('checkbox',{name:/Enable storefront widget/});
  expect(screen.getByRole('heading',{name:'Widget / Installation'})).toBeInTheDocument();
  expect(screen.getByRole('checkbox',{name:/Enable storefront widget/})).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:/Approved hostnames/})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Copy embed snippet'})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'Visual Preview'})).toBeInTheDocument();
  expect(screen.queryByText(/recent customer activity|Visitor [A-Z0-9]+/i)).not.toBeInTheDocument();
  expect(container.querySelector('.preview-avatar svg')).not.toBeNull();
  expect(container.querySelector('.widget-snippet code')?.textContent).toContain(`${window.location.origin}/widget.js`);
  expect(container.querySelector('.widget-snippet code')?.textContent).toContain('data-widget-id="widget_public_id_123456"');
  expect(container.querySelector('.widget-snippet code')?.textContent).not.toContain('?v=');
 });
 it('keeps the preview default icon behind a custom avatar and after image failure',async()=>{
  const {container}=render(<MemoryRouter initialEntries={['/workspace/shop/widget']}><Routes><Route path="/workspace/:slug/widget" element={<WidgetInstallationPage/>}/></Routes></MemoryRouter>);
  await screen.findByRole('textbox',{name:/Avatar image URL/});
  fireEvent.change(screen.getByRole('textbox',{name:/Avatar image URL/}),{target:{value:'https://images.example/avatar.png'}});
  const image=container.querySelector<HTMLImageElement>('.preview-avatar img');
  expect(image).not.toBeNull();
  expect(container.querySelector('.preview-avatar svg')).not.toBeNull();
  fireEvent.error(image!);
  expect(container.querySelector('.preview-avatar img')).toBeNull();
  expect(container.querySelector('.preview-avatar svg')).not.toBeNull();
 });
});
