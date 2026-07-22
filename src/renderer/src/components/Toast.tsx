import { useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './Toast.module.css'

interface Props {
  message: string
  onDone(): void
  durationMs?: number
}

/** Transient status message. Auto-dismisses; clicking dismisses immediately. */
export function Toast({ message, onDone, durationMs = 5000 }: Props): React.JSX.Element {
  useEffect(() => {
    const t = window.setTimeout(onDone, durationMs)
    return () => window.clearTimeout(t)
  }, [message, onDone, durationMs])

  return (
    <motion.div
      className={styles.toast}
      role="status"
      data-testid="toast"
      onClick={onDone}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      {message}
    </motion.div>
  )
}
