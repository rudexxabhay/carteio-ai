import { useLocation, useNavigate } from 'react-router-dom';
import { Meta } from '../../components/common/Meta';
import { NotFound } from '../../components/common/ErrorStates';
export function NotFoundPage() { const location=useLocation(); const navigate=useNavigate(); return <><Meta title="Page not found" description="The requested Carteio AI page could not be found." path={location.pathname} noIndex/><NotFound onHome={() => navigate('/')}/></>; }
