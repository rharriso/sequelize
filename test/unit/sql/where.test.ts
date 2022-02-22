import util from 'util';
import attempt from 'lodash/attempt';
import type {
  WhereOptions,
  ModelAttributeColumnOptions,
  Utils,
} from 'sequelize';
// eslint-disable-next-line import/order -- issue with mixing require & import
import {
  DataTypes,
  QueryTypes,
  Op,
  literal,
  col,
  where,
  fn,
  json,
  cast,
  and,
  or,
} from 'sequelize';

const support = require('../support');

const { sequelize, expectsql } = support;

const sql = sequelize.dialect.queryGenerator;

// Notice: [] will be replaced by dialect specific tick/quote character
// when there is no dialect specific expectation but only a default expectation

// TODO:
//  - test casting { 'firstName::string': 'zoe' }

type Options = {
  type?: QueryTypes,
  prefix?: string | Utils.Literal,
  field?: ModelAttributeColumnOptions,
  model?: {
    rawAttributes: { [attribute: string]: ModelAttributeColumnOptions },
  },
};

type Expectations = {
  [dialectName: string]: string | Error,
};

const dialectSupportsArray = () => sequelize.dialect.supports.ARRAY;
const dialectSupportsRange = () => sequelize.dialect.supports.RANGE;

describe(support.getTestDialectTeaser('SQL'), () => {
  describe('whereQuery', () => {
    it('prefixes its output with WHERE when it is not empty', () => {
      expectsql(
        sql.whereQuery({ firstName: 'abc' }),
        {
          default: `WHERE [firstName] = 'abc'`,
          mssql: `WHERE [firstName] = N'abc'`,
        },
      );
    });

    it('returns an empty string if the input results in an empty query', () => {
      expectsql(
        sql.whereQuery({ firstName: { [Op.notIn]: [] } }),
        {
          default: '',
        },
      );
    });
  });

  describe('whereItemsQuery', () => {
    function testSql(params: WhereOptions, expectations: Expectations): void;
    function testSql(params: WhereOptions, options: Options, expectation: Expectations): void;
    function testSql(params: WhereOptions, optionsOrExpectations: Options | Expectations, expectation?: Expectations): void {
      let options: Options | undefined;
      if (expectation === undefined) {
        // @ts-expect-error
        expectation = optionsOrExpectations;
      } else {
        options = optionsOrExpectations;
      }

      it(util.inspect(params, { depth: 10 }) + (options ? `, ${util.inspect(options)}` : ''), () => {
        const sqlOrError = attempt(sql.whereItemsQuery.bind(sql), params, options);

        return expectsql(sqlOrError, expectation);
      });
    }

    testSql({}, {
      default: '',
    });

    testSql([], {
      default: '',
    });

    // @ts-expect-error id is not allowed to be undefined
    testSql({ id: undefined }, {
      default: new Error('WHERE parameter "id" has invalid "undefined" value'),
    });

    testSql({ id: 1, user: undefined }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    });

    testSql({ id: 1, user: undefined }, { type: QueryTypes.SELECT }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    });

    testSql({ id: 1, user: undefined }, { type: QueryTypes.BULKDELETE }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    });

    testSql({ id: 1, user: undefined }, { type: QueryTypes.BULKUPDATE }, {
      default: new Error('WHERE parameter "user" has invalid "undefined" value'),
    });

    testSql({ id: 1 }, { prefix: 'User' }, {
      default: '[User].[id] = 1',
    });

    it('{ id: 1 }, { prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, {schema: \'yolo\', tableName: \'User\'})) }', () => {
      expectsql(sql.whereItemsQuery({ id: 1 }, { prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, { schema: 'yolo', tableName: 'User' })) }), {
        default: '[yolo.User].[id] = 1',
        postgres: '"yolo"."User"."id" = 1',
        db2: '"yolo"."User"."id" = 1',
        snowflake: '"yolo"."User"."id" = 1',
        mariadb: '`yolo`.`User`.`id` = 1',
        mssql: '[yolo].[User].[id] = 1',
      });
    });

    describe('value serialization', () => {
      // string
      testSql({ id: '1' }, {
        default: `[id] = '1'`,
        mssql: `[id] = N'1'`,
      });

      testSql({
        name: 'here is a null char: \0',
      }, {
        default: '[name] = \'here is a null char: \\0\'',
        snowflake: '"name" = \'here is a null char: \0\'',
        mssql: '[name] = N\'here is a null char: \0\'',
        db2: '"name" = \'here is a null char: \0\'',
        sqlite: '`name` = \'here is a null char: \0\'',
      });

      describe('Buffer', () => {
        testSql({ field: Buffer.from('Sequelize') }, {
          postgres: '"field" = E\'\\\\x53657175656c697a65\'',
          sqlite: '`field` = X\'53657175656c697a65\'',
          mariadb: '`field` = X\'53657175656c697a65\'',
          mysql: '`field` = X\'53657175656c697a65\'',
          db2: '"field" = BLOB(\'Sequelize\')',
          snowflake: '"field" = X\'53657175656c697a65\'',
          mssql: '[field] = 0x53657175656c697a65',
        });

        testSql({ field: [Buffer.from('Sequelize1'), Buffer.from('Sequelize2')] }, {
          postgres: '"field" IN (E\'\\\\x53657175656c697a6531\', E\'\\\\x53657175656c697a6532\')',
          sqlite: '`field` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mariadb: '`field` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mysql: '`field` IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          db2: '"field" IN (BLOB(\'Sequelize1\'), BLOB(\'Sequelize2\'))',
          snowflake: '"field" IN (X\'53657175656c697a6531\', X\'53657175656c697a6532\')',
          mssql: '[field] IN (0x53657175656c697a6531, 0x53657175656c697a6532)',
        });
      });
    });

    describe('implicit operator', () => {
      testSql({ id: 1 }, {
        default: '[id] = 1',
      });

      testSql({ id: '1' }, {
        default: `[id] = '1'`,
        mssql: `[id] = N'1'`,
      });

      testSql({ id: [1, 2] }, {
        default: '[id] IN (1, 2)',
      });

      testSql({ id: ['1', '2'] }, {
        default: `[id] IN ('1', '2')`,
        mssql: `[id] IN (N'1', N'2')`,
      });

      testSql({ active: true }, {
        default: `[active] = true`,
        mssql: '[active] = 1',
        sqlite: '`active` = 1',
      });

      testSql({
        name: 'a project',
        id: {
          [Op.or]: [
            [1, 2, 3],
            { [Op.gt]: 10 },
          ],
        },
      }, {
        default: '[name] = \'a project\' AND ([id] IN (1, 2, 3) OR [id] > 10)',
        mssql: '[name] = N\'a project\' AND ([id] IN (1, 2, 3) OR [id] > 10)',
      });

      testSql({ deleted: null }, {
        default: '[deleted] IS NULL',
      });

      testSql({ birthday: new Date('2021-01-01T00:00:00Z') }, {
        default: `[birthday] = '2021-01-01 00:00:00.000 +00:00'`,
        mariadb: `\`birthday\` = '2021-01-01 00:00:00.000'`,
        mysql: `\`birthday\` = '2021-01-01 00:00:00'`,
        snowflake: `"birthday" = '2021-01-01 00:00:00'`,
        db2: `"birthday" = '2021-01-01 00:00:00'`,
      });

      testSql({ col1: { [Op.col]: 'col2' } }, {
        default: '[col1] = [col2]',
      });

      // TODO: this test is failing!
      // testSql({ col1: col('col2') }, {
      //   default: '[col1] = [col2]',
      // });

      // TODO: this test is failing!
      // testSql({ col: literal('literal') }, {
      //   default: '[col] = literal',
      // });

      testSql({ col1: fn('UPPER', col('col2')) }, {
        default: '[col1] = UPPER("col2")',
      });

      // TODO: this test is failing!
      // testSql({ col: cast(col('col'), 'string') }, {
      //   default: '[col] = CAST("col" AS STRING)',
      // });

      if (dialectSupportsArray()) {
        testSql({ col: { [Op.any]: [2, 3, 4] } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" = ANY (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.any]: literal('literal') } }, {
          default: '[col] = ANY (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.any]: [literal('1'), literal('2')] } }, {
        //   default: '[col] = ANY (ARRAY[1,2])',
        // });

        testSql({ col: { [Op.all]: [2, 3, 4] } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" = ALL (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.all]: literal('literal') } }, {
          default: '[col] = ALL (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.all]: [literal('1'), literal('2')] } }, {
        //   default: '[col] = ALL (ARRAY[1,2])',
        // });
      }
    });

    describe('Op.eq', () => {
      testSql({ id: { [Op.eq]: 1 } }, {
        default: '[id] = 1',
      });

      if (dialectSupportsArray()) {
        testSql({ id: { [Op.eq]: [1, 2] } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"id" = ARRAY[1,2]',
        });
      }

      testSql({ deleted: { [Op.eq]: null } }, {
        default: '[deleted] IS NULL',
      });

      testSql({ deleted: { [Op.eq]: true } }, {
        default: '[deleted] = true',
      });

      testSql({ col1: { [Op.eq]: { [Op.col]: 'col2' } } }, {
        default: '[col1] = [col2]',
      });

      testSql({ col1: { [Op.eq]: col('col2') } }, {
        default: '[col1] = [col2]',
      });

      testSql({ col: { [Op.eq]: literal('literal') } }, {
        default: '[col] = literal',
      });

      testSql({ col1: { [Op.eq]: fn('UPPER', col('col2')) } }, {
        default: '[col1] = UPPER("col2")',
      });

      testSql({ col: { [Op.eq]: cast(col('col'), 'string') } }, {
        default: '[col] = CAST("col" AS STRING)',
      });

      if (dialectSupportsArray()) {
        testSql({ col: { [Op.eq]: { [Op.any]: [2, 3, 4] } } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" = ANY (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.eq]: { [Op.any]: literal('literal') } } }, {
          default: '[col] = ANY (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.eq]: { [Op.any]: [literal('1'), literal('2')] } } }, {
        //   default: '[col] = ANY (ARRAY[1,2])',
        // });

        testSql({ col: { [Op.eq]: { [Op.all]: [2, 3, 4] } } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" = ALL (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.eq]: { [Op.all]: literal('literal') } } }, {
          default: '[col] = ALL (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.eq]: { [Op.all]: [literal('1'), literal('2')] } } }, {
        //   default: '[col] = ALL (ARRAY[1,2])',
        // });
      }
    });

    describe('Op.ne', () => {
      testSql({ id: { [Op.ne]: 1 } }, {
        default: '[id] != 1',
      });

      if (dialectSupportsArray()) {
        testSql({ id: { [Op.ne]: [1, 2] } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"id" != ARRAY[1,2]',
        });
      }

      testSql({ deleted: { [Op.ne]: null } }, {
        default: '[deleted] IS NOT NULL',
      });

      testSql({ deleted: { [Op.ne]: true } }, {
        default: '[deleted] != true',
      });

      testSql({ col1: { [Op.ne]: { [Op.col]: 'col2' } } }, {
        default: '[col1] != [col2]',
      });

      testSql({ col1: { [Op.ne]: col('col2') } }, {
        default: '[col1] != [col2]',
      });

      testSql({ col: { [Op.ne]: literal('literal') } }, {
        default: '[col] != literal',
      });

      testSql({ col1: { [Op.ne]: fn('UPPER', col('col2')) } }, {
        default: '[col1] != UPPER("col2")',
      });

      testSql({ col: { [Op.ne]: cast(col('col'), 'string') } }, {
        default: '[col] != CAST("col" AS STRING)',
      });

      if (dialectSupportsArray()) {
        testSql({ col: { [Op.ne]: { [Op.any]: [2, 3, 4] } } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" != ANY (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.ne]: { [Op.any]: literal('literal') } } }, {
          default: '[col] != ANY (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.ne]: { [Op.any]: [literal('1'), literal('2')] } } }, {
        //   default: '[col] != ANY (ARRAY[1,2])',
        // });

        testSql({ col: { [Op.ne]: { [Op.all]: [2, 3, 4] } } }, {
          // 'default' is not used because ARRAY[2,3,4] is transformed into ARRAY"2,3,4"
          postgres: '"col" != ALL (ARRAY[2,3,4])',
        });

        testSql({ col: { [Op.ne]: { [Op.all]: literal('literal') } } }, {
          default: '[col] != ALL (literal)',
        });

        // TODO: this test is failing
        // testSql({ col: { [Op.ne]: { [Op.all]: [literal('1'), literal('2')] } } }, {
        //   default: '[col] != ALL (ARRAY[1,2])',
        // });
      }
    });

    describe('Op.not', () => {
      testSql({ deleted: { [Op.not]: true } }, {
        default: '[deleted] IS NOT true',
        mssql: '[deleted] IS NOT 1',
        sqlite: '`deleted` IS NOT 1',
      });

      testSql({ deleted: { [Op.not]: null } }, {
        default: '[deleted] IS NOT NULL',
      });

      testSql({ muscles: { [Op.not]: 3 } }, {
        default: '[muscles] != 3',
      });
    });

    describe('Op.gt', () => {
      testSql({
        rank: { [Op.gt]: 2 },
      }, {
        default: '[rank] > 2',
      });
    });

    describe('Op.lt', () => {
      testSql({
        created_at: {
          [Op.lt]: {
            [Op.col]: 'updated_at',
          },
        },
      }, {
        default: '[created_at] < [updated_at]',
      });
    });

    describe('Op.between', () => {
      testSql({
        date: {
          [Op.between]: ['2013-01-01', '2013-01-11'],
        },
      }, {
        default: '[date] BETWEEN \'2013-01-01\' AND \'2013-01-11\'',
        mssql: '[date] BETWEEN N\'2013-01-01\' AND N\'2013-01-11\'',
      });

      testSql({
        date: {
          [Op.between]: [new Date('2013-01-01'), new Date('2013-01-11')],
        },
      }, {
        default: '[date] BETWEEN \'2013-01-01 00:00:00.000 +00:00\' AND \'2013-01-11 00:00:00.000 +00:00\'',
        mysql: '`date` BETWEEN \'2013-01-01 00:00:00\' AND \'2013-01-11 00:00:00\'',
        db2: '"date" BETWEEN \'2013-01-01 00:00:00\' AND \'2013-01-11 00:00:00\'',
        snowflake: '"date" BETWEEN \'2013-01-01 00:00:00\' AND \'2013-01-11 00:00:00\'',
        mariadb: '`date` BETWEEN \'2013-01-01 00:00:00.000\' AND \'2013-01-11 00:00:00.000\'',
      });

      testSql({
        date: {
          [Op.between]: [1_356_998_400_000, 1_357_862_400_000],
        },
      }, {
        model: {
          rawAttributes: {
            date: {
              type: new DataTypes.DATE(),
            },
          },
        },
      }, {
        default: '[date] BETWEEN \'2013-01-01 00:00:00.000 +00:00\' AND \'2013-01-11 00:00:00.000 +00:00\'',
        mssql: '[date] BETWEEN N\'2013-01-01 00:00:00.000 +00:00\' AND N\'2013-01-11 00:00:00.000 +00:00\'',
      });

      testSql({
        date: {
          [Op.between]: ['2012-12-10', '2013-01-02'],
          [Op.notBetween]: ['2013-01-04', '2013-01-20'],
        },
      }, {
        default: '([date] BETWEEN \'2012-12-10\' AND \'2013-01-02\' AND [date] NOT BETWEEN \'2013-01-04\' AND \'2013-01-20\')',
        mssql: '([date] BETWEEN N\'2012-12-10\' AND N\'2013-01-02\' AND [date] NOT BETWEEN N\'2013-01-04\' AND N\'2013-01-20\')',
      });
    });

    describe('Op.notBetween', () => {
      testSql({
        date: {
          [Op.notBetween]: ['2013-01-01', '2013-01-11'],
        },
      }, {
        default: '[date] NOT BETWEEN \'2013-01-01\' AND \'2013-01-11\'',
        mssql: '[date] NOT BETWEEN N\'2013-01-01\' AND N\'2013-01-11\'',
      });
    });

    describe('Op.in', () => {
      testSql({ equipment: { [Op.in]: [1, 3] } }, {
        default: '[equipment] IN (1, 3)',
      });

      testSql({ equipment: { [Op.in]: [] } }, {
        default: '[equipment] IN (NULL)',
      });

      testSql({
        equipment: {
          [Op.in]: literal('(select order_id from product_orders where product_id = 3)'),
        },
      }, {
        default: '[equipment] IN (select order_id from product_orders where product_id = 3)',
      });
    });

    describe('Op.notIn', () => {
      testSql({
        equipment: {
          [Op.notIn]: [],
        },
      }, {
        default: '',
      });

      testSql({
        equipment: {
          [Op.notIn]: [4, 19],
        },
      }, {
        default: '[equipment] NOT IN (4, 19)',
      });

      testSql({
        equipment: {
          [Op.notIn]: literal('(select order_id from product_orders where product_id = 3)'),
        },
      }, {
        default: '[equipment] NOT IN (select order_id from product_orders where product_id = 3)',
      });
    });

    describe('Op.like', () => {
      testSql({
        username: {
          [Op.like]: '%swagger',
        },
      }, {
        default: '[username] LIKE \'%swagger\'',
        mssql: '[username] LIKE N\'%swagger\'',
      });

      // TODO: don't disable test suites if the dialect doesn't support.
      //  instead, ensure dialect throws an error if these operators are used.

      if (dialectSupportsArray()) {
        testSql({
          userId: {
            [Op.like]: {
              [Op.any]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" LIKE ANY (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.iLike]: {
              [Op.any]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" ILIKE ANY (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.notLike]: {
              [Op.any]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" NOT LIKE ANY (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.notILike]: {
              [Op.any]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" NOT ILIKE ANY (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.like]: {
              [Op.all]: ['foo', 'bar', 'baz'],
            },
          },

        }, {
          postgres: '"userId" LIKE ALL (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.iLike]: {
              [Op.all]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" ILIKE ALL (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.notLike]: {
              [Op.all]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" NOT LIKE ALL (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });

        testSql({
          userId: {
            [Op.notILike]: {
              [Op.all]: ['foo', 'bar', 'baz'],
            },
          },
        }, {
          postgres: '"userId" NOT ILIKE ALL (ARRAY[\'foo\',\'bar\',\'baz\'])',
        });
      }
    });

    // TODO: check that startsWith properly escape contents!

    describe('Op.startsWith', () => {
      testSql({
        username: {
          [Op.startsWith]: 'swagger',
        },
      }, {
        default: '[username] LIKE \'swagger%\'',
        mssql: '[username] LIKE N\'swagger%\'',
      });

      testSql({
        username: {
          [Op.startsWith]: literal('swagger'),
        },
      }, {
        default: '[username] LIKE \'swagger%\'',
        mssql: '[username] LIKE N\'swagger%\'',
      });
    });

    // TODO: check that endsWith properly escape contents!

    describe('Op.endsWith', () => {
      testSql({
        username: {
          [Op.endsWith]: 'swagger',
        },
      }, {
        default: '[username] LIKE \'%swagger\'',
        mssql: '[username] LIKE N\'%swagger\'',
      });

      testSql({
        username: {
          [Op.endsWith]: literal('swagger'),
        },
      }, {
        default: '[username] LIKE \'%swagger\'',
        mssql: '[username] LIKE N\'%swagger\'',
      });
    });

    // TODO: check that substring properly escape contents (except literals)!

    describe('Op.substring', () => {
      testSql({
        username: {
          [Op.substring]: 'swagger',
        },
      }, {
        default: '[username] LIKE \'%swagger%\'',
        mssql: '[username] LIKE N\'%swagger%\'',
      });

      testSql({
        username: {
          [Op.substring]: literal('swagger'),
        },
      }, {
        default: '[username] LIKE \'%swagger%\'',
        mssql: '[username] LIKE N\'%swagger%\'',
      });
    });

    if (sequelize.dialect.supports.REGEXP) {
      describe('Op.regexp', () => {
        testSql({
          username: {
            [Op.regexp]: '^sw.*r$',
          },
        }, {
          mariadb: '`username` REGEXP \'^sw.*r$\'',
          mysql: '`username` REGEXP \'^sw.*r$\'',
          snowflake: '"username" REGEXP \'^sw.*r$\'',
          postgres: '"username" ~ \'^sw.*r$\'',
        });
      });

      describe('Op.regexp', () => {
        testSql({
          newline: {
            [Op.regexp]: '^new\nline$',
          },
        }, {
          mariadb: '`newline` REGEXP \'^new\\nline$\'',
          mysql: '`newline` REGEXP \'^new\\nline$\'',
          snowflake: '"newline" REGEXP \'^new\nline$\'',
          postgres: '"newline" ~ \'^new\nline$\'',
        });
      });

      describe('Op.notRegexp', () => {
        testSql({
          username: {
            [Op.notRegexp]: '^sw.*r$',
          },
        }, {
          mariadb: '`username` NOT REGEXP \'^sw.*r$\'',
          mysql: '`username` NOT REGEXP \'^sw.*r$\'',
          snowflake: '"username" NOT REGEXP \'^sw.*r$\'',
          postgres: '"username" !~ \'^sw.*r$\'',
        });
      });

      describe('Op.notRegexp', () => {
        testSql({
          newline: {
            [Op.notRegexp]: '^new\nline$',
          },
        }, {
          mariadb: '`newline` NOT REGEXP \'^new\\nline$\'',
          mysql: '`newline` NOT REGEXP \'^new\\nline$\'',
          snowflake: '"newline" NOT REGEXP \'^new\nline$\'',
          postgres: '"newline" !~ \'^new\nline$\'',
        });
      });

      if (sequelize.dialect.name === 'postgres') {
        describe('Op.iRegexp', () => {
          testSql({
            username: {
              [Op.iRegexp]: '^sw.*r$',
            },
          }, {
            postgres: '"username" ~* \'^sw.*r$\'',
          });
        });

        describe('Op.iRegexp', () => {
          testSql({
            newline: {
              [Op.iRegexp]: '^new\nline$',
            },
          }, {
            postgres: '"newline" ~* \'^new\nline$\'',
          });
        });

        describe('Op.notIRegexp', () => {
          testSql({
            username: {
              [Op.notIRegexp]: '^sw.*r$',
            },
          }, {
            postgres: '"username" !~* \'^sw.*r$\'',
          });
        });

        describe('Op.notIRegexp', () => {
          testSql({
            newline: {
              [Op.notIRegexp]: '^new\nline$',
            },
          }, {
            postgres: '"newline" !~* \'^new\nline$\'',
          });
        });
      }
    }

    if (sequelize.dialect.supports.TSVESCTOR) {
      describe('Op.match', () => {
        testSql({
          username: {
            [Op.match]: fn('to_tsvector', 'swagger'),
          },
        }, {
          postgres: '[username] @@ to_tsvector(\'swagger\')',
        });
      });
    }

    // TODO: don't disable test suites if the dialect doesn't support.
    //  instead, ensure dialect throws an error if these operators are used.
    if (dialectSupportsArray()) {
      describe('Op.contains', () => {
        testSql({
          muscles: {
            [Op.contains]: [2, 3],
          },
        }, {
          postgres: '"muscles" @> ARRAY[2,3]',
        });

        testSql({
          muscles: {
            [Op.contains]: [2, 5],
          },
        }, {
          field: {
            type: DataTypes.ARRAY(DataTypes.INTEGER),
          },
        }, {
          postgres: '"muscles" @> ARRAY[2,5]::INTEGER[]',
        });

        testSql({
          muscles: {
            [Op.contains]: ['stringValue1', 'stringValue2', 'stringValue3'],
          },
        }, {
          postgres: '"muscles" @> ARRAY[\'stringValue1\',\'stringValue2\',\'stringValue3\']',
        });

        testSql({
          muscles: {
            [Op.contains]: ['stringValue1', 'stringValue2'],
          },
        }, {
          field: {
            type: DataTypes.ARRAY(DataTypes.STRING),
          },
        }, {
          postgres: '"muscles" @> ARRAY[\'stringValue1\',\'stringValue2\']::VARCHAR(255)[]',
        });
      });

      describe('Op.contained', () => {
        testSql({
          muscles: {
            [Op.contained]: [6, 8],
          },
        }, {
          postgres: '"muscles" <@ ARRAY[6,8]',
        });

        testSql({
          muscles: {
            [Op.contained]: ['stringValue1', 'stringValue2', 'stringValue3'],
          },
        }, {
          postgres: '"muscles" <@ ARRAY[\'stringValue1\',\'stringValue2\',\'stringValue3\']',
        });
      });

      describe('Op.overlap', () => {
        testSql({
          muscles: {
            [Op.overlap]: [3, 11],
          },
        }, {
          postgres: '"muscles" && ARRAY[3,11]',
        });
      });

      describe('Op.any', () => {
        testSql({
          userId: {
            [Op.any]: [4, 5, 6],
          },
        }, {
          postgres: '"userId" = ANY (ARRAY[4,5,6])',
        });

        testSql({
          userId: {
            [Op.any]: [2, 5],
          },
        }, {
          field: {
            type: DataTypes.ARRAY(DataTypes.INTEGER),
          },
        }, {
          postgres: '"userId" = ANY (ARRAY[2,5]::INTEGER[])',
        });

        describe('Op.values', () => {
          testSql({
            userId: {
              [Op.any]: {
                [Op.values]: [4, 5, 6],
              },
            },
          }, {
            postgres: '"userId" = ANY (VALUES (4), (5), (6))',
          });

          testSql({
            userId: {
              [Op.any]: {
                [Op.values]: [2, 5],
              },
            },
          }, {
            field: {
              type: DataTypes.ARRAY(DataTypes.INTEGER),
            },
          }, {
            postgres: '"userId" = ANY (VALUES (2), (5))',
          });
        });
      });

      describe('Op.all', () => {
        testSql({
          userId: {
            [Op.all]: [4, 5, 6],
          },
        }, {
          postgres: '"userId" = ALL (ARRAY[4,5,6])',
        });

        testSql({
          userId: {
            [Op.all]: [2, 5],
          },
        }, {
          field: {
            type: DataTypes.ARRAY(DataTypes.INTEGER),
          },
        }, {
          postgres: '"userId" = ALL (ARRAY[2,5]::INTEGER[])',
        });

        describe('Op.values', () => {
          testSql({
            userId: {
              [Op.all]: {
                [Op.values]: [4, 5, 6],
              },
            },

          }, {
            postgres: '"userId" = ALL (VALUES (4), (5), (6))',
          });

          testSql({
            userId: {
              [Op.all]: {
                [Op.values]: [2, 5],
              },
            },
          }, {
            field: {
              type: DataTypes.ARRAY(DataTypes.INTEGER),
            },
          }, {
            postgres: '"userId" = ALL (VALUES (2), (5))',
          });
        });
      });
    }

    if (dialectSupportsRange()) {
      describe('RANGE', () => {

        testSql({
          range: {
            [Op.contains]: new Date(Date.UTC(2000, 1, 1)),
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        }, {
          postgres: '"Timeline"."range" @> \'2000-02-01 00:00:00.000 +00:00\'::timestamptz',
        });

        testSql({
          range: {
            [Op.contains]: [new Date(Date.UTC(2000, 1, 1)), new Date(Date.UTC(2000, 2, 1))],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        }, {
          postgres: '"Timeline"."range" @> \'["2000-02-01 00:00:00.000 +00:00","2000-03-01 00:00:00.000 +00:00")\'',
        });

        testSql({
          unboundedRange: {
            [Op.contains]: [new Date(Date.UTC(2000, 1, 1)), null],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        }, {
          postgres: '"Timeline"."unboundedRange" @> \'["2000-02-01 00:00:00.000 +00:00",)\'',
        });

        testSql({
          unboundedRange: {
            [Op.contains]: [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        }, {
          postgres: '"Timeline"."unboundedRange" @> \'[-infinity,infinity)\'',
        });

        testSql({
          range: {
            [Op.contained]: [new Date(Date.UTC(2000, 1, 1)), new Date(Date.UTC(2000, 2, 1))],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(DataTypes.DATE),
          },
          prefix: 'Timeline',
        }, {
          postgres: '"Timeline"."range" <@ \'["2000-02-01 00:00:00.000 +00:00","2000-03-01 00:00:00.000 +00:00")\'',
        });

        testSql({
          reservedSeats: {
            [Op.overlap]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" && \'[1,4)\'',
        });

        testSql({
          reservedSeats: {
            [Op.adjacent]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" -|- \'[1,4)\'',
        });

        testSql({
          reservedSeats: {
            [Op.strictLeft]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" << \'[1,4)\'',
        });

        testSql({
          reservedSeats: {
            [Op.strictRight]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" >> \'[1,4)\'',
        });

        testSql({
          reservedSeats: {
            [Op.noExtendRight]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" &< \'[1,4)\'',
        });

        testSql({
          reservedSeats: {
            [Op.noExtendLeft]: [1, 4],
          },
        }, {
          field: {
            type: new DataTypes.postgres.RANGE(),
          },
          prefix: 'Room',
        }, {
          postgres: '"Room"."reservedSeats" &> \'[1,4)\'',
        });
      });
    }

    if (sequelize.dialect.supports.JSON) {
      describe('JSON', () => {
        testSql(json('profile.id', cast('12346-78912', 'text')), {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        }, {
          postgres: '("profile"#>>\'{id}\') = CAST(\'12346-78912\' AS TEXT)',
          sqlite: 'json_extract(`profile`,\'$.id\') = CAST(\'12346-78912\' AS TEXT)',
          mariadb: 'json_unquote(json_extract(`profile`,\'$.id\')) = CAST(\'12346-78912\' AS CHAR)',
          mysql: 'json_unquote(json_extract(`profile`,\'$.\\"id\\"\')) = CAST(\'12346-78912\' AS CHAR)',
        });

        testSql(json({ profile: { id: '12346-78912', name: 'test' } }), {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        }, {
          postgres: '("profile"#>>\'{id}\') = \'12346-78912\' AND ("profile"#>>\'{name}\') = \'test\'',
          sqlite: 'json_extract(`profile`,\'$.id\') = \'12346-78912\' AND json_extract(`profile`,\'$.name\') = \'test\'',
          mariadb: 'json_unquote(json_extract(`profile`,\'$.id\')) = \'12346-78912\' AND json_unquote(json_extract(`profile`,\'$.name\')) = \'test\'',
          mysql: 'json_unquote(json_extract(`profile`,\'$.\\"id\\"\')) = \'12346-78912\' AND json_unquote(json_extract(`profile`,\'$.\\"name\\"\')) = \'test\'',
        });

        testSql({
          data: {
            nested: {
              attribute: 'value',
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        }, {
          mariadb: 'json_unquote(json_extract(`User`.`data`,\'$.nested.attribute\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`User`.`data`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\'',
          postgres: '("User"."data"#>>\'{nested,attribute}\') = \'value\'',
          sqlite: 'json_extract(`User`.`data`,\'$.nested.attribute\') = \'value\'',
        });

        testSql({
          data: {
            nested: {
              [Op.in]: [1, 2],
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested\')) AS DECIMAL) IN (1, 2)',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\"\')) AS DECIMAL) IN (1, 2)',
          postgres: 'CAST(("data"#>>\'{nested}\') AS DOUBLE PRECISION) IN (1, 2)',
          sqlite: 'CAST(json_extract(`data`,\'$.nested\') AS DOUBLE PRECISION) IN (1, 2)',
        });

        testSql({
          data: {
            nested: {
              [Op.between]: [1, 2],
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested\')) AS DECIMAL) BETWEEN 1 AND 2',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\"\')) AS DECIMAL) BETWEEN 1 AND 2',
          postgres: 'CAST(("data"#>>\'{nested}\') AS DOUBLE PRECISION) BETWEEN 1 AND 2',
          sqlite: 'CAST(json_extract(`data`,\'$.nested\') AS DOUBLE PRECISION) BETWEEN 1 AND 2',
        });

        testSql({
          data: {
            nested: {
              attribute: 'value',
              prop: {
                [Op.ne]: 'None',
              },
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: literal(sql.quoteTable.call(sequelize.dialect.queryGenerator, { tableName: 'User' })),
        }, {
          mariadb: '(json_unquote(json_extract(`User`.`data`,\'$.nested.attribute\')) = \'value\' AND json_unquote(json_extract(`User`.`data`,\'$.nested.prop\')) != \'None\')',
          mysql: '(json_unquote(json_extract(`User`.`data`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\' AND json_unquote(json_extract(`User`.`data`,\'$.\\"nested\\".\\"prop\\"\')) != \'None\')',
          postgres: '(("User"."data"#>>\'{nested,attribute}\') = \'value\' AND ("User"."data"#>>\'{nested,prop}\') != \'None\')',
          sqlite: '(json_extract(`User`.`data`,\'$.nested.attribute\') = \'value\' AND json_extract(`User`.`data`,\'$.nested.prop\') != \'None\')',
        });

        testSql({
          data: {
            name: {
              last: 'Simpson',
            },
            employment: {
              [Op.ne]: 'None',
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
          prefix: 'User',
        }, {
          mariadb: '(json_unquote(json_extract(`User`.`data`,\'$.name.last\')) = \'Simpson\' AND json_unquote(json_extract(`User`.`data`,\'$.employment\')) != \'None\')',
          mysql: '(json_unquote(json_extract(`User`.`data`,\'$.\\"name\\".\\"last\\"\')) = \'Simpson\' AND json_unquote(json_extract(`User`.`data`,\'$.\\"employment\\"\')) != \'None\')',
          postgres: '(("User"."data"#>>\'{name,last}\') = \'Simpson\' AND ("User"."data"#>>\'{employment}\') != \'None\')',
          sqlite: '(json_extract(`User`.`data`,\'$.name.last\') = \'Simpson\' AND json_extract(`User`.`data`,\'$.employment\') != \'None\')',
        });

        testSql({
          data: {
            price: 5,
            name: 'Product',
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: '(CAST(json_unquote(json_extract(`data`,\'$.price\')) AS DECIMAL) = 5 AND json_unquote(json_extract(`data`,\'$.name\')) = \'Product\')',
          mysql: '(CAST(json_unquote(json_extract(`data`,\'$.\\"price\\"\')) AS DECIMAL) = 5 AND json_unquote(json_extract(`data`,\'$.\\"name\\"\')) = \'Product\')',
          postgres: '(CAST(("data"#>>\'{price}\') AS DOUBLE PRECISION) = 5 AND ("data"#>>\'{name}\') = \'Product\')',
          sqlite: '(CAST(json_extract(`data`,\'$.price\') AS DOUBLE PRECISION) = 5 AND json_extract(`data`,\'$.name\') = \'Product\')',
        });

        testSql({ 'data.nested.attribute': 'value' }, {
          model: {
            rawAttributes: {
              data: {
                type: new DataTypes.JSONB(),
              },
            },
          },
        }, {
          mariadb: 'json_unquote(json_extract(`data`,\'$.nested.attribute\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\'',
          postgres: '("data"#>>\'{nested,attribute}\') = \'value\'',
          sqlite: 'json_extract(`data`,\'$.nested.attribute\') = \'value\'',
        });

        testSql({ 'data.nested.attribute': 4 }, {
          model: {
            rawAttributes: {
              data: {
                type: new DataTypes.JSON(),
              },
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested.attribute\')) AS DECIMAL) = 4',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) = 4',
          postgres: 'CAST(("data"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) = 4',
          sqlite: 'CAST(json_extract(`data`,\'$.nested.attribute\') AS DOUBLE PRECISION) = 4',
        });

        testSql({
          'data.nested.attribute': {
            [Op.in]: [3, 7],
          },
        }, {
          model: {
            rawAttributes: {
              data: {
                type: new DataTypes.JSONB(),
              },
            },
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested.attribute\')) AS DECIMAL) IN (3, 7)',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) IN (3, 7)',
          postgres: 'CAST(("data"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) IN (3, 7)',
          sqlite: 'CAST(json_extract(`data`,\'$.nested.attribute\') AS DOUBLE PRECISION) IN (3, 7)',
        });

        testSql({
          data: {
            nested: {
              attribute: {
                [Op.gt]: 2,
              },
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested.attribute\')) AS DECIMAL) > 2',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) > 2',
          postgres: 'CAST(("data"#>>\'{nested,attribute}\') AS DOUBLE PRECISION) > 2',
          sqlite: 'CAST(json_extract(`data`,\'$.nested.attribute\') AS DOUBLE PRECISION) > 2',
        });

        testSql({
          data: {
            nested: {
              'attribute::integer': {
                [Op.gt]: 2,
              },
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: 'CAST(json_unquote(json_extract(`data`,\'$.nested.attribute\')) AS DECIMAL) > 2',
          mysql: 'CAST(json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) AS DECIMAL) > 2',
          postgres: 'CAST(("data"#>>\'{nested,attribute}\') AS INTEGER) > 2',
          sqlite: 'CAST(json_extract(`data`,\'$.nested.attribute\') AS INTEGER) > 2',
        });

        const dt = new Date();
        testSql({
          data: {
            nested: {
              attribute: {
                [Op.gt]: dt,
              },
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: `CAST(json_unquote(json_extract(\`data\`,'$.nested.attribute')) AS DATETIME) > ${sql.escape(dt)}`,
          mysql: `CAST(json_unquote(json_extract(\`data\`,'$.\\"nested\\".\\"attribute\\"')) AS DATETIME) > ${sql.escape(dt)}`,
          postgres: `CAST(("data"#>>'{nested,attribute}') AS TIMESTAMPTZ) > ${sql.escape(dt)}`,
          sqlite: `json_extract(\`data\`,'$.nested.attribute') > ${sql.escape(dt.toISOString())}`,
        });

        testSql({
          data: {
            nested: {
              attribute: true,
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          mariadb: 'json_unquote(json_extract(`data`,\'$.nested.attribute\')) = \'true\'',
          mysql: 'json_unquote(json_extract(`data`,\'$.\\"nested\\".\\"attribute\\"\')) = \'true\'',
          postgres: 'CAST(("data"#>>\'{nested,attribute}\') AS BOOLEAN) = true',
          sqlite: 'CAST(json_extract(`data`,\'$.nested.attribute\') AS BOOLEAN) = 1',
        });

        testSql({ 'metaData.nested.attribute': 'value' }, {
          model: {
            rawAttributes: {
              metaData: {
                field: 'meta_data',
                fieldName: 'metaData',
                type: new DataTypes.JSONB(),
              },
            },
          },
        }, {
          mariadb: 'json_unquote(json_extract(`meta_data`,\'$.nested.attribute\')) = \'value\'',
          mysql: 'json_unquote(json_extract(`meta_data`,\'$.\\"nested\\".\\"attribute\\"\')) = \'value\'',
          postgres: '("meta_data"#>>\'{nested,attribute}\') = \'value\'',
          sqlite: 'json_extract(`meta_data`,\'$.nested.attribute\') = \'value\'',
        });
      });
    }

    if (sequelize.dialect.supports.JSONB) {
      describe('JSONB', () => {
        testSql({
          data: {
            [Op.contains]: {
              company: 'Magnafone',
            },
          },
        }, {
          field: {
            type: new DataTypes.JSONB(),
          },
        }, {
          default: '[data] @> \'{"company":"Magnafone"}\'',
        });
      });
    }

    // TODO: OR

    testSql({
      name: 'a project',
      [Op.or]: [
        { id: [1, 2, 3] },
        { id: { [Op.gt]: 10 } },
      ],
    }, {
      default: '([id] IN (1, 2, 3) OR [id] > 10) AND [name] = \'a project\'',
      mssql: '([id] IN (1, 2, 3) OR [id] > 10) AND [name] = N\'a project\'',
    });
  });

  describe('whereItemQuery', () => {
    function testSql(key: string | undefined, value, options, expectation) {
      if (expectation === undefined) {
        expectation = options;
        options = undefined;
      }

      it(`${String(key)}: ${util.inspect(value, { depth: 10 })}${options && `, ${util.inspect(options)}` || ''}`, () => {
        return expectsql(sql.whereItemQuery(key, value, options), expectation);
      });
    }

    testSql(undefined, 'lol=1', {
      default: 'lol=1',
    });

    describe('Op.and/Op.or/Op.not', () => {
      describe('Op.or', () => {
        testSql('email', {
          [Op.or]: ['maker@mhansen.io', 'janzeh@gmail.com'],
        }, {
          default: '([email] = \'maker@mhansen.io\' OR [email] = \'janzeh@gmail.com\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [email] = N\'janzeh@gmail.com\')',
        });

        testSql('rank', {
          [Op.or]: {
            [Op.lt]: 100,
            [Op.eq]: null,
          },
        }, {
          default: '([rank] < 100 OR [rank] IS NULL)',
        });

        testSql(Op.or, [
          { email: 'maker@mhansen.io' },
          { email: 'janzeh@gmail.com' },
        ], {
          default: '([email] = \'maker@mhansen.io\' OR [email] = \'janzeh@gmail.com\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [email] = N\'janzeh@gmail.com\')',
        });

        testSql(Op.or, {
          email: 'maker@mhansen.io',
          name: 'Mick Hansen',
        }, {
          default: '([email] = \'maker@mhansen.io\' OR [name] = \'Mick Hansen\')',
          mssql: '([email] = N\'maker@mhansen.io\' OR [name] = N\'Mick Hansen\')',
        });

        testSql(Op.or, {
          equipment: [1, 3],
          muscles: {
            [Op.in]: [2, 4],
          },
        }, {
          default: '([equipment] IN (1, 3) OR [muscles] IN (2, 4))',
        });

        testSql(Op.or, [
          {
            roleName: 'NEW',
          }, {
            roleName: 'CLIENT',
            type: 'CLIENT',
          },
        ], {
          default: '([roleName] = \'NEW\' OR ([roleName] = \'CLIENT\' AND [type] = \'CLIENT\'))',
          mssql: '([roleName] = N\'NEW\' OR ([roleName] = N\'CLIENT\' AND [type] = N\'CLIENT\'))',
        });

        it('or({group_id: 1}, {user_id: 2})', () => {
          expectsql(sql.whereItemQuery(undefined, or({ group_id: 1 }, { user_id: 2 })), {
            default: '([group_id] = 1 OR [user_id] = 2)',
          });
        });

        it('or({group_id: 1}, {user_id: 2, role: \'admin\'})', () => {
          expectsql(sql.whereItemQuery(undefined, or({ group_id: 1 }, { user_id: 2, role: 'admin' })), {
            default: '([group_id] = 1 OR ([user_id] = 2 AND [role] = \'admin\'))',
            mssql: '([group_id] = 1 OR ([user_id] = 2 AND [role] = N\'admin\'))',
          });
        });

        testSql(Op.or, [], {
          default: '0 = 1',
        });

        testSql(Op.or, {}, {
          default: '0 = 1',
        });

        it('or()', () => {
          expectsql(sql.whereItemQuery(undefined, or()), {
            default: '0 = 1',
          });
        });
      });

      describe('Op.and', () => {
        testSql(Op.and, {
          [Op.or]: {
            group_id: 1,
            user_id: 2,
          },
          shared: 1,
        }, {
          default: '(([group_id] = 1 OR [user_id] = 2) AND [shared] = 1)',
        });

        testSql(Op.and, [
          {
            name: {
              [Op.like]: '%hello',
            },
          },
          {
            name: {
              [Op.like]: 'hello%',
            },
          },
        ], {
          default: '([name] LIKE \'%hello\' AND [name] LIKE \'hello%\')',
          mssql: '([name] LIKE N\'%hello\' AND [name] LIKE N\'hello%\')',
        });

        testSql('rank', {
          [Op.and]: {
            [Op.ne]: 15,
            [Op.between]: [10, 20],
          },
        }, {
          default: '([rank] != 15 AND [rank] BETWEEN 10 AND 20)',
        });

        testSql('name', {
          [Op.and]: [
            { [Op.like]: '%someValue1%' },
            { [Op.like]: '%someValue2%' },
          ],
        }, {
          default: '([name] LIKE \'%someValue1%\' AND [name] LIKE \'%someValue2%\')',
          mssql: '([name] LIKE N\'%someValue1%\' AND [name] LIKE N\'%someValue2%\')',
        });

        it('and({shared: 1, or({group_id: 1}, {user_id: 2}))', () => {
          expectsql(sql.whereItemQuery(undefined, and({ shared: 1 }, or({ group_id: 1 }, { user_id: 2 }))), {
            default: '([shared] = 1 AND ([group_id] = 1 OR [user_id] = 2))',
          });
        });
      });

      describe('Op.not', () => {
        testSql(Op.not, {
          [Op.or]: {
            group_id: 1,
            user_id: 2,
          },
          shared: 1,
        }, {
          default: 'NOT (([group_id] = 1 OR [user_id] = 2) AND [shared] = 1)',
        });

        testSql(Op.not, [], {
          default: '0 = 1',
        });

        testSql(Op.not, {}, {
          default: '0 = 1',
        });
      });
    });

    describe('Op.col', () => {
      testSql('userId', {
        [Op.col]: 'user.id',
      }, {
        default: '[userId] = [user].[id]',
      });

      testSql('userId', {
        [Op.eq]: {
          [Op.col]: 'user.id',
        },
      }, {
        default: '[userId] = [user].[id]',
      });

      testSql('userId', {
        [Op.gt]: {
          [Op.col]: 'user.id',
        },
      }, {
        default: '[userId] > [user].[id]',
      });

      testSql(Op.or, [
        { ownerId: { [Op.col]: 'user.id' } },
        { ownerId: { [Op.col]: 'organization.id' } },
      ], {
        default: '([ownerId] = [user].[id] OR [ownerId] = [organization].[id])',
      });

      testSql('$organization.id$', {
        [Op.col]: 'user.organizationId',
      }, {
        default: '[organization].[id] = [user].[organizationId]',
      });

      testSql('$offer.organization.id$', {
        [Op.col]: 'offer.user.organizationId',
      }, {
        default: '[offer->organization].[id] = [offer->user].[organizationId]',
      });
    });

    describe('fn', () => {
      it('{name: fn(\'LOWER\', \'DERP\')}', () => {
        expectsql(sql.whereQuery({ name: fn('LOWER', 'DERP') }), {
          default: 'WHERE [name] = LOWER(\'DERP\')',
          mssql: 'WHERE [name] = LOWER(N\'DERP\')',
        });
      });
    });
  });

  describe('getWhereConditions', () => {
    function testSql(value, expectation) {
      const User = sequelize.define('user', {});

      it(util.inspect(value, { depth: 10 }), () => {
        return expectsql(sql.getWhereConditions(value, User.tableName, User), expectation);
      });
    }

    testSql(where(fn('lower', col('name')), null), {
      default: 'lower([name]) IS NULL',
    });

    testSql(where(fn('SUM', col('hours')), '>', 0), {
      default: 'SUM([hours]) > 0',
    });

    testSql(where(fn('SUM', col('hours')), Op.gt, 0), {
      default: 'SUM([hours]) > 0',
    });

    testSql(where(fn('lower', col('name')), Op.ne, null), {
      default: 'lower([name]) IS NOT NULL',
    });

    testSql(where(fn('lower', col('name')), Op.not, null), {
      default: 'lower([name]) IS NOT NULL',
    });

    testSql([where(fn('SUM', col('hours')), Op.gt, 0),
      where(fn('lower', col('name')), null)], {
      default: '(SUM([hours]) > 0 AND lower([name]) IS NULL)',
    });

    testSql(where(col('hours'), Op.between, [0, 5]), {
      default: '[hours] BETWEEN 0 AND 5',
    });

    testSql(where(col('hours'), Op.notBetween, [0, 5]), {
      default: '[hours] NOT BETWEEN 0 AND 5',
    });

    testSql(where(literal(`'hours'`), Op.eq, 'hours'), {
      default: `'hours' = 'hours'`,
      mssql: `'hours' = N'hours'`,
    });

    it('where(left: ModelAttributeColumnOptions, op, right)', () => {
      const User = sequelize.define('user', {
        id: {
          type: DataTypes.INTEGER,
          field: 'internal_id',
          primaryKey: true,
        },
      });

      const whereObj = where(User.getAttributes().id, Op.eq, 1);
      const expectations = { default: '[user].[internal_id] = 1' };

      return expectsql(sql.getWhereConditions(whereObj, User.tableName, User), expectations);
    });
  });
});