const lancedb = require('vectordb')
const { Schema, Field, Float32, List, Int32, Float16, Utf8, FixedSizeList, Float } = require("apache-arrow")
const { createHash } = require('crypto')
const OpenAI = require('openai')

// https://lancedb.github.io/lancedb/basic/#create-a-table-from-initial-data

const TABLE_NAME = 'vectors'
const VECTOR_LENGTH = 1536 // "text-embedding-3-small"

const SCHEMA = new Schema([
  new Field('vector', new FixedSizeList(VECTOR_LENGTH, new Field("item", new Float32()))), // Embeddingの計算結果
  new Field('text', new Utf8()), // 元文章
  new Field('hash', new Utf8()), // textのハッシュ値 (同一判定用)
  new Field('metadata', new Utf8()), // JSON.stringify/parseして使う想定
])

function toHash(text) {
  return createHash('md5').update(text).digest('hex')
}

class VDB {
  constructor(db, table) {
    /** @type import('vectordb').Connection */
    this.db = db
    /** @type import('vectordb').Table */
    this.table = table;
  }

  /**
   * @param {string} dirPath
   */
  static async init(dirPath) {

    const db = await lancedb.connect(dirPath)
    const table = await (async () => {
      try {
        return await db.openTable(TABLE_NAME)
      } catch {
        return await db.createTable({ name: TABLE_NAME, schema: SCHEMA })
      }
    })()

    return new VDB(db, table)
  }

  /**
   * @param {string} text vectorに対応するテキスト (ユニークなIDとして利用される)
   * @param {number[]} vector Embeddingの計算結果
   * @param {Object} metadata その他付随させたいメタデータ。なければ{}でよい
  */
  async addItem(text, vector, metadata = {}) {
    return (await this.addItems([{ text, vector, metadata }]))[0]
  }

  /**
   * @param {{text: string, vector: number[], metadata: object}[]} items
   */
  async addItems(items) {
    const countOld = await this.table.countRows()

    const itemsToBeAdded = items.map(({ text, vector, metadata }) => ({
      text,
      vector,
      hash: toHash(text),
      metadata: JSON.stringify(metadata),
    }))

    await this.table.add(itemsToBeAdded) // NOTE: return valueで追加された数が返ってくるらしいが、undefinedが来る
    const countNew = await this.table.countRows()

    await this.__updateIndex(countOld, countNew)

    return itemsToBeAdded // 戻り値はfindByTextに合わせる
  }

  /**
   *
   * @returns {Promise<{hash: string, text: string, vector: number[], metadata: object, distance: number}[]>}
   */
  async query(vector, limit = 3) {
    // number[] を入れれば ANN index が貼られたキーが自動で選択される
    // https://lancedb.github.io/lancedb/fts/
    /** @type {{hash: string, text: string, vector: number[], metadata: string, _distance: number}[]} */
    const results = await this.table.search(vector).limit(limit).execute()

    return results.map(({hash, text, vector, metadata, _distance, ...rest}) => {
      return {
        ...rest, // このクラスとしては明記されたキーが戻り値に含まれることを規定し、その他を含むかは任意と考える
        distance: _distance,
        vector,
        hash,
        text,
        metadata: JSON.parse(metadata),
      }
    })
  }

  /**
   * textが既に登録済みか調べる
   * @returns {Promise<{hash: string, text: string, vector: number[], metadata: object} | null>}
   */
  async findByText(text) {
    const hash = toHash(text)
    // https://lancedb.github.io/lancedb/sql/#filtering-without-vector-search
    const items = await this.table.filter(`hash = '${hash}'`).limit(1).execute()
    if (! items.length) return null
    if (items[0].hash != hash) return null
    const { vector, metadata } = items[0]
    return {
      ...items[0], // このクラスとしては明記されたキーが戻り値に含まれることを規定し、その他を含むかは任意と考える
      vector,
      hash,
      text,
      metadata: JSON.parse(metadata),
    }
  }

  // https://lancedb.github.io/lancedb/ann_indexes/#creating-an-ivf_pq-index
  // https://api.python.langchain.com/en/latest/vectorstores/langchain_community.vectorstores.lancedb.LanceDB.html
  // 実際に入っているデータ数 > num_partitions > num_sub_vectors にならないといけない？
  async __updateIndex(countOld, countNew) {
    const oldNumPartitions = Math.floor(Math.sqrt(countOld))
    const newNumPartitions = Math.floor(Math.sqrt(countNew))

    if (oldNumPartitions != newNumPartitions) {
      // FIXME: num_partitionsが正しく渡ってなくて、常に256になっている: https://github.com/lancedb/lancedb/issues/526
      // count < 256 だとエラーになるので、その場合はindexを作らないようにブロックする
      if (countNew < 256) {
        console.log(`Rebuilding index: skipped (countNew = ${countNew} < 256)`)

      } else {
        console.log(`Rebuilding index: num_partitons ${oldNumPartitions} -> ${newNumPartitions}`) // ↑の理由で多分実際のnum_partitionsは違っている

        await this.table.createIndex({
          column: 'vector',
          type: "ivf_pq",
          num_partitions: newNumPartitions,
        })
      }

      // ついでにこのタイミングでhashのindexも更新
      await this.table.createScalarIndex('hash')
    }
  }
}

///////////////////////////////////////////////////////////////////////////////

const EMBEDDING_MODEL = "text-embedding-3-small"

async function calcEmbedding (text, apiKey) {
    const openai = new OpenAI({apiKey})
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    })

    return res.data[0].embedding
}

async function retrieveTextByEmbedding(dbPath, text, apiKey, limit) {
    try{
        const db = await VDB.init(dbPath)

        const embedding = await calcEmbedding(text, apiKey)
        return await db.query(embedding, limit)
    } catch {
        throw new Error
    }
}

module.exports = { VDB, retrieveTextByEmbedding }
