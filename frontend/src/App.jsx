import React from 'react'
import { Routes, Route } from 'react-router-dom'
import Home from './Home'
import Disclaimer from './Disclaimer'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/disclaimer" element={<Disclaimer />} />
    </Routes>
  )
}

export default App
