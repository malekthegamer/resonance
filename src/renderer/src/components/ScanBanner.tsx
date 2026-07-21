import { AnimatePresence, motion } from 'framer-motion'
import { useLibrary } from '../state/library'
import styles from './ScanBanner.module.css'

/** Live scan progress. Visible only while a scan is actually running. */
export function ScanBanner(): React.JSX.Element {
  const scan = useLibrary((s) => s.scan)
  const active = scan.phase === 'walking' || scan.phase === 'parsing'

  const pct =
    scan.filesFound > 0 ? Math.min(100, (scan.filesProcessed / scan.filesFound) * 100) : 0

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className={styles.banner}
          data-testid="scan-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className={styles.inner}>
            <div className={styles.text}>
              <span className={styles.label}>
                {scan.phase === 'walking' ? 'Finding music…' : 'Reading tags…'}
              </span>
              <span className={styles.counts}>
                {scan.filesProcessed.toLocaleString()} / {scan.filesFound.toLocaleString()}
              </span>
            </div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${pct}%` }} />
            </div>
            <p className={styles.current} title={scan.currentFile}>
              {scan.currentFile.split(/[\\/]/).pop() ?? ''}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
