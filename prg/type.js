const { Type } = require('@sinclair/typebox');
const { Value } = require('@sinclair/typebox/value');
const { ValueErrorType } = require('@sinclair/typebox/errors');
const { TypeGuard } = require('@sinclair/typebox/type');

/**
 * @typedef {import('@sinclair/typebox/type').TSchema} TSchema
 * @typedef {import('@sinclair/typebox/type').TProperties} TProperties
 */

/**
 * @template {TSchema} S
 * @typedef {import('@sinclair/typebox').Static<S>} Static
 */

/**
 * @template {TProperties} P
 * @param {P} props
 */
function ExactObject(props, option = {}) {
  return Type.Object(props, {...option, additionalProperties: false})
}

/**
 * Validates the given data and return **type-annotated** object.
 * Throws an error if there are any validation errors.
 * @template {TSchema} S
 * @param {S} schema
 * @return {Static<S>}
 */
function parse(schema, data) {
  data = Value.Default(schema, Value.Clone(data))

  function recursive(schema, data) {
    // Type.Unionはどの配下でもパースできなかった場合に 'expected union value' しか返してくれない
    // 候補型の1つ目 (anyOf[0]) がobjectの場合は、基本的にその型でパースされることを期待していると想定する
    // その場合にエラーメッセージが読みやすいように、anyOf[0]のスキーマに対して再帰的にErrorをチェックする
    return [...Value.Errors(schema, data)].flatMap(e => {
      if (e.type !== ValueErrorType.Union) return [e]
      const anyOf0 = e.schema.anyOf[0]
      if (anyOf0.type !== 'object') return [e]

      return recursive(anyOf0, e.value).map(ee => ({
        ...e,
        path: e.path + ee.path,
        message: ee.message,
      }))
    })
  }

  const errors = recursive(schema, data).map(({path, message}) => ({path, message}))
  if (errors.length) throw new Error(JSON.stringify(errors, null, 2))

  return data
}

/**
 * nested objectの下にdefaultがある場合に、そのdefaultを上に伝播させる (スキーマ定義の記載シンプル化)
 * @template {TSchema} S
 * @param {S} schema
 */
function propagateDefaultToParent(schema){
  if (schema.default != null) return schema

  if (schema.properties != null) { // object
    for (const [key, prop] of Object.entries(schema.properties)) {
      propagateDefaultToParent(prop)
      if ('default' in prop) {
        schema.default = {}
      }
    }
  } else if (schema.items != null) { // array
    propagateDefaultToParent(schema.items) // arrayの要素型という意味でitemsになっているが、schema.items自体は単数
    if ('default' in schema.items) {
      schema.default = []
    }
  } else if (schema.anyOf != null) { // union
    for (const type of schema.anyOf) {
      propagateDefaultToParent(type)
      // 最初にdefaultが付いているものがValue.Defaultで呼ばれるようなので、それに合わせる
      // 実際、1つ目にdefaultのないobject, 2つ目にdefaultのあるobjectを使った場合に、
      // どちらも{}を元にValue.Defaultできるが、2つ目のValue.Defaultが呼ばれていた
      if ('default' in type && schema.default == null) {
        schema.default = structuredClone(type.default)
      }
    }
  }

  return schema // inplaceに書き換えてるが、関数をwrapしやすいように
}

/**
 * default指定のあるスキーマをOptional扱いにする。以下のような目的:
 * - コード内では必ずValue.Defaultを通して使うので、Requiredでスキーマを定義
 * - 設定ファイルとしてはdefault付きキーを記載不要 (= Optional) とし、そのようなJSONSchemaを出力
 * ちなみにdefault有無にかかわらずdeepPartialするものは試作があるらしい: https://github.com/sinclairzx81/typebox/blob/master/example/prototypes/partial-deep.ts
 * @template {TSchema} S
 * @param {S} schema
 * @return {TSchema} // FIXME 型推論できる書き方にしてない (すぐtoJSONSchemaに渡すので問題ないという考え)
 */
function defaultOptional(schema){
  schema = Value.Clone(schema) // deep cloneを再帰しているので無駄が多いが…

  if (TypeGuard.IsObject(schema)) {
    const entries = Object.entries(schema.properties)
      .map(([key, prop]) => [key, defaultOptional(prop)])
    schema.properties = Object.fromEntries(entries)

    const options = entries
      .filter(([key, prop]) => (TypeGuard.IsSchema(prop) && prop.default != null))
      .map(([key, prop]) => key)
    const required = schema.required?.filter(key => !options.includes(key))
    schema.required = required?.length ? required : undefined

  } else if (TypeGuard.IsArray(schema)) {
    schema.items = defaultOptional(schema.items)

  } else if (TypeGuard.IsUnion(schema)) {
    schema.anyOf = schema.anyOf.map(defaultOptional)
  }

  return schema
}

/**
 * JSON Schemaの形式で出力する
 */
function toJSONSchema(schema){
  return JSON.stringify(Type.Strict(schema), null, 2)
}

///////////////////////////////////////////////////////////////////////////////

const OutputTypes = [
  Type.Literal('normal'),
  Type.Literal('diff'),
  Type.Literal('append'),
  Type.Literal('ask')
]

const PromptArray = propagateDefaultToParent(
  Type.Array(
    Type.Union([
      // objectかstringのどちらか
      ExactObject({
        label:       Type.String({default: ''}),
        description: Type.String(),
        output:      ExactObject({
          backup:      Type.Boolean({default: false}),
          type:        Type.Union(OutputTypes, {default: 'diff'}),
        }),
      }),

      // リスト直下に文字列がある場合もOKとする (実装側でdescriptionに埋め直す)
      Type.String(),
    ])
  )
)
const Prompt = PromptArray.items.anyOf[0]
/** @typedef {Static<typeof PromptArray>}                PromptArrayType */
/** @typedef {Static<typeof PromptArray.items.anyOf[0]>} PromptType */

module.exports = {
  Type, parse, Prompt, PromptArray
}

///////////////////////////////////////////////////////////////////////////////

// JSONSchemaの出力は↓
// console.log(toJSONSchema(defaultOptional(PromptArray)))

// // テスト
// console.log(parse(PromptArray, [
//   'pass', // ただの文字列はOK
//   {description: 'test'}, // default未設定のdescriptionされあれば後はdefaultが適用されてOK
// ]))
// console.log(parse(PromptArray, [
//   {}, // Prompt型でrequiredのdescriptionがないのでエラー (その際にPrompt型としてのエラーが表示される)
//   {description: 'test', output: {type: 'another'}}, // typeが候補にないのでエラー
//   {label: 4, description: 'test'}, // labelがstringでないのでエラー
// ]))
