'use strict';

/**
 * Replace free-text court_locations.address with structured US address fields.
 * Pre-launch: best-effort backfill from legacy address, then drop the column.
 */

function parseLegacyAddress(address) {
  if (address == null || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const address_line1 = parts[0] || 'Unknown';
  let city = 'Unknown';
  let state = 'XX';
  let postal_code = '00000';

  if (parts.length >= 2) {
    city = parts[1] || city;
  }
  if (parts.length >= 3) {
    const stateZip = parts[2].split(/\s+/).filter(Boolean);
    if (stateZip[0]) {
      const st = stateZip[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      state = st.length === 2 ? st : state;
    }
    if (stateZip[1] && /^\d{5}(-\d{4})?$/.test(stateZip[1])) {
      postal_code = stateZip[1];
    }
  }

  return {
    address_line1: address_line1.slice(0, 255),
    city: String(city).slice(0, 100),
    state,
    postal_code,
    country: 'US',
  };
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex('court_locations', 'unique_court').catch(() => {});

    await queryInterface.addColumn('court_locations', 'address_line1', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('court_locations', 'city', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
    await queryInterface.addColumn('court_locations', 'state', {
      type: Sequelize.STRING(2),
      allowNull: true,
    });
    await queryInterface.addColumn('court_locations', 'postal_code', {
      type: Sequelize.STRING(20),
      allowNull: true,
    });
    await queryInterface.addColumn('court_locations', 'country', {
      type: Sequelize.STRING(2),
      allowNull: true,
      defaultValue: 'US',
    });

    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, address FROM court_locations',
    );
    for (const row of rows) {
      const parsed = parseLegacyAddress(row.address) || {
        address_line1: 'Unknown',
        city: 'Unknown',
        state: 'XX',
        postal_code: '00000',
        country: 'US',
      };
      await queryInterface.sequelize.query(
        `UPDATE court_locations
         SET address_line1 = :address_line1,
             city = :city,
             state = :state,
             postal_code = :postal_code,
             country = :country
         WHERE id = :id`,
        {
          replacements: { id: row.id, ...parsed },
        },
      );
    }

    await queryInterface.changeColumn('court_locations', 'address_line1', {
      type: Sequelize.STRING(255),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'city', {
      type: Sequelize.STRING(100),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'state', {
      type: Sequelize.STRING(2),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'postal_code', {
      type: Sequelize.STRING(20),
      allowNull: false,
    });
    await queryInterface.changeColumn('court_locations', 'country', {
      type: Sequelize.STRING(2),
      allowNull: false,
      defaultValue: 'US',
    });

    await queryInterface.removeColumn('court_locations', 'address');

    await queryInterface.addIndex(
      'court_locations',
      ['name', 'address_line1', 'city', 'state', 'postal_code', 'country'],
      { unique: true, name: 'unique_court' },
    );
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('court_locations', 'unique_court').catch(() => {});

    await queryInterface.addColumn('court_locations', 'address', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });

    const [rows] = await queryInterface.sequelize.query(
      'SELECT id, address_line1, city, state, postal_code FROM court_locations',
    );
    for (const row of rows) {
      const address = [row.address_line1, row.city, `${row.state} ${row.postal_code}`]
        .filter(Boolean)
        .join(', ');
      await queryInterface.sequelize.query(
        'UPDATE court_locations SET address = :address WHERE id = :id',
        { replacements: { id: row.id, address } },
      );
    }

    await queryInterface.removeColumn('court_locations', 'address_line1');
    await queryInterface.removeColumn('court_locations', 'city');
    await queryInterface.removeColumn('court_locations', 'state');
    await queryInterface.removeColumn('court_locations', 'postal_code');
    await queryInterface.removeColumn('court_locations', 'country');

    await queryInterface.addIndex('court_locations', ['name', 'address'], {
      unique: true,
      name: 'unique_court',
    });
  },
};
