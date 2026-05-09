import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Library from './pages/Library'
import Analytics from './pages/Analytics'
import Hardware from './pages/Hardware'
import Vault from './pages/Vault'
import Settings from './pages/Settings'
import Search from './pages/Search'
import Versions from './pages/Versions'
import Engineers from './pages/Engineers'
import Janitor from './pages/Janitor'
import Playlists from './pages/Playlists'
import Polyphony from './pages/Polyphony'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Library />} />
          <Route path="search" element={<Search />} />
          <Route path="versions" element={<Versions />} />
          <Route path="engineers" element={<Engineers />} />
          <Route path="janitor" element={<Janitor />} />
          <Route path="playlists" element={<Playlists />} />
          <Route path="polyphony" element={<Polyphony />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="hardware" element={<Hardware />} />
          <Route path="vault" element={<Vault />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
