import { Component } from 'react'

function isChunkError(msg) {
  return msg && (
    msg.includes('dynamically imported module') ||
    msg.includes('Failed to fetch dynamically') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('Unable to preload CSS')
  )
}

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    // Chunk obsolète après déploiement → rechargement automatique
    if (isChunkError(error?.message)) {
      window.location.reload()
      return { error: null }
    }
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 text-red-500 text-sm">
          <p className="font-bold">Erreur :</p>
          <pre className="text-xs mt-1 whitespace-pre-wrap">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 px-3 py-1 bg-red-100 rounded text-red-700 text-xs"
          >Réessayer</button>
        </div>
      )
    }
    return this.props.children
  }
}
