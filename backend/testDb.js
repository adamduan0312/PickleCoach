// testDb.js
import { Sequelize } from 'sequelize';

const sequelize = new Sequelize('picklecoach', 'root', '03122003Ad!', {
  host: '127.0.0.1',
  dialect: 'mysql',
  port: 3306
});

(async () => {
  try {
    await sequelize.authenticate();
    const [results] = await sequelize.query("SHOW TABLES;");
    console.log("Tables in picklecoach:", results);
  } catch (error) {
    console.error(error);
  } finally {
    await sequelize.close();
  }
})();

