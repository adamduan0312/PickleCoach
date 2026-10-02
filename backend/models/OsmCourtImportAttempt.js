import { DataTypes } from 'sequelize';
import { sequelize } from './sequelize.js';

/** OSM feature that nearby discovery tried and could not import; skipped until the retry cooldown passes. */
const OsmCourtImportAttempt = sequelize.define('osm_court_import_attempt', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  osm_type: {
    type: DataTypes.STRING(16),
    allowNull: false,
  },
  osm_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  outcome: {
    type: DataTypes.STRING(32),
    allowNull: false,
  },
  attempted_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },
}, {
  tableName: 'osm_court_import_attempts',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { unique: true, fields: ['osm_type', 'osm_id'], name: 'unique_osm_court_import_attempt' },
  ],
});

export default OsmCourtImportAttempt;
