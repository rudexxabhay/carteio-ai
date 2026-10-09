import { Link, useLocation } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { ArrowLeft } from 'lucide-react';
export function NotFoundPage() { const location=useLocation(); return <><Meta title="Page not found" description="The requested Carteio AI page could not be found." path={location.pathname} noIndex/><section className="simple-page section-wrap"><span className="eyebrow">404 — PAGE NOT FOUND</span><h1>This page isn’t here yet.</h1><p>The address may be wrong, or the page may have moved.</p><Link className="button button-primary" to="/"><ArrowLeft size={16}/> Back to home</Link></section></>; }
